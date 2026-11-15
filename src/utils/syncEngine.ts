import type { KnowledgeTile } from '../types';
import {
  deleteCloudTile,
  fetchCloudAiStats,
  fetchCloudTiles,
  saveBatchCloudTiles,
} from './apiClient';

export type SyncState = 'connected' | 'syncing' | 'offline' | 'error';

export interface SyncStats {
  todayRequests: number;
  todayTokens: number;
  avgLatency: number;
}

export interface SyncEngineListeners {
  onStatusChange?: (status: SyncState) => void;
  onTilesUpdated?: (presetId: string, tiles: KnowledgeTile[]) => void;
  onStatsUpdated?: (stats: SyncStats) => void;
  onError?: (err: Error) => void;
}

/**
 * Wyznacza deterministyczny podpis stanu kafelków do błyskawicznego porównywania bez zbędnych re-renderów.
 */
export function computeTilesFingerprint(tiles: KnowledgeTile[]): string {
  if (!tiles || tiles.length === 0) return 'empty';
  return tiles
    .map((t) => `${t.id}:${t.title.length}:${t.content.length}:${t.enabled ? 1 : 0}:${t.priority || 'std'}`)
    .sort()
    .join('|');
}

/**
 * Precyzyjne wykrywanie zmian pomiędzy stanem lokalnym a serwerowym Neon DB
 */
export function diffTiles(local: KnowledgeTile[], remote: KnowledgeTile[]): {
  hasDeletions: boolean;
  hasAdditions: boolean;
  hasUpdates: boolean;
  isDifferent: boolean;
} {
  const localMap = new Map(local.map((t) => [t.id, t]));
  const remoteMap = new Map(remote.map((t) => [t.id, t]));

  // Kafelki usunięte na zdalnym serwerze (były u nas, ale nie ma ich na serwerze)
  const hasDeletions = local.some((t) => !remoteMap.has(t.id));

  // Nowe kafelki dodane zdalnie (są na serwerze, ale nie ma u nas)
  const hasAdditions = remote.some((t) => !localMap.has(t.id));

  // Zaktualizowana treść lub status istniejącego kafelka
  const hasUpdates = remote.some((rt) => {
    const loc = localMap.get(rt.id);
    if (!loc) return false;
    return (
      loc.content !== rt.content ||
      loc.title !== rt.title ||
      loc.category !== rt.category ||
      loc.enabled !== rt.enabled ||
      loc.priority !== rt.priority ||
      loc.visibility !== rt.visibility
    );
  });

  return {
    hasDeletions,
    hasAdditions,
    hasUpdates,
    isDifferent: hasDeletions || hasAdditions || hasUpdates,
  };
}

export class RobustSyncEngine {
  private activePresetId: string = 'modular-homes';
  private localTiles: KnowledgeTile[] = [];
  private listeners: SyncEngineListeners = {};
  private status: SyncState = 'connected';
  private isSyncing = false;
  private abortController: AbortController | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private consecutiveErrors = 0;
  private baseIntervalMs = 6000;
  private isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

  constructor(initialPresetId: string, initialTiles: KnowledgeTile[], listeners: SyncEngineListeners) {
    this.activePresetId = initialPresetId;
    this.localTiles = initialTiles;
    this.listeners = listeners;

    this.setupNetworkListeners();
    this.startPolling();
  }

  private setupNetworkListeners() {
    if (typeof window === 'undefined') return;

    window.addEventListener('online', () => {
      this.isOnline = true;
      this.consecutiveErrors = 0;
      this.updateStatus('connected');
      void this.syncNow(false);
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.updateStatus('offline');
    });

    // Błyskawiczna synchronizacja przy powrocie do aplikacji na telefonie lub przełączeniu karty
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.isOnline) {
        void this.syncNow(false);
      }
    });
  }

  public setPreset(newPresetId: string, newTiles: KnowledgeTile[]) {
    if (this.activePresetId === newPresetId) return;

    // Anuluj wszelkie żądania sieciowe dla poprzedniego profilu
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.activePresetId = newPresetId;
    this.localTiles = newTiles;
    this.consecutiveErrors = 0;
    void this.syncNow(true);
  }

  public updateLocalTiles(tiles: KnowledgeTile[]) {
    this.localTiles = tiles;
  }

  private updateStatus(newStatus: SyncState) {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.listeners.onStatusChange?.(newStatus);
    }
  }

  public async syncNow(isInitial = false): Promise<void> {
    if (!this.isOnline) {
      this.updateStatus('offline');
      return;
    }

    if (this.isSyncing) return; // Mutex lock

    this.isSyncing = true;
    const currentPreset = this.activePresetId;

    try {
      this.abortController = new AbortController();

      // Pobierz kafelki dla aktywnego profilu z Neon DB
      const res = await fetchCloudTiles(currentPreset);

      if (this.activePresetId !== currentPreset) {
        // Użytkownik w międzyczasie zmienił profil, odrzuć odpowiedź
        return;
      }

      if (!res.success) throw new Error('Serwer zwrócił niepowodzenie');

      const serverTiles = (res.tiles || []) as KnowledgeTile[];

      // 1. Inicjalizacja pustej bazy Neon danymi lokalnymi
      if (serverTiles.length === 0 && this.localTiles.length > 0) {
        await saveBatchCloudTiles(this.localTiles, currentPreset, 'Inicjalizacja');
        this.updateStatus('connected');
        this.consecutiveErrors = 0;
        return;
      }

      // 2. Initial seeding jeśli lokalnie mamy więcej (np. pierwsze wejście z PC z 30+ kafelkami)
      const diff = diffTiles(this.localTiles, serverTiles);

      if (isInitial && this.localTiles.length > serverTiles.length && !diff.hasDeletions) {
        await saveBatchCloudTiles(this.localTiles, currentPreset, 'Inicjalizacja');
        this.updateStatus('connected');
        this.consecutiveErrors = 0;
        return;
      }

      // 3. Zastosowanie zmian z serwera Neon DB
      if (diff.isDifferent) {
        this.localTiles = serverTiles;
        this.listeners.onTilesUpdated?.(currentPreset, serverTiles);
      }

      // 4. Pobranie globalnych statystyk zapytań AI
      try {
        const statsRes = await fetchCloudAiStats();
        if (statsRes.success && statsRes.stats) {
          this.listeners.onStatsUpdated?.(statsRes.stats);
        }
      } catch {
        // Ciche ignorowanie błędu statystyk, nie blokuje bazy wiedzy
      }

      this.updateStatus('connected');
      this.consecutiveErrors = 0;
    } catch (err: unknown) {
      this.consecutiveErrors++;
      // Po 3 nieudanych próbach ustaw stan błędu, nie panikuj przy pojedynczym blipie
      if (this.consecutiveErrors >= 3) {
        this.updateStatus('error');
      }
      this.listeners.onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.isSyncing = false;
      this.abortController = null;
    }
  }

  /**
   * Zapis kafelków do chmury z natychmiastowym wykrywaniem i kasowaniem usuniętych kafelków
   */
  public async pushTiles(newTiles: KnowledgeTile[], authorName: string): Promise<{ deletedCount: number }> {
    const nextMap = new Map(newTiles.map((t) => [t.id, t]));

    // Wykryj kafelki usunięte lokalnie
    const deletedTiles = this.localTiles.filter((t) => !nextMap.has(t.id));

    this.localTiles = newTiles;
    this.updateStatus('syncing');

    try {
      // 1. Natychmiastowe usunięcie skasowanych kafelków
      for (const del of deletedTiles) {
        void deleteCloudTile(del.id);
      }

      // 2. Równoległy zapis wsadowy do Neon DB
      await saveBatchCloudTiles(newTiles, this.activePresetId, authorName);

      this.updateStatus('connected');
      this.consecutiveErrors = 0;
      return { deletedCount: deletedTiles.length };
    } catch (err) {
      this.updateStatus('error');
      throw err;
    }
  }

  private startPolling() {
    this.stopPolling();
    this.timer = setInterval(() => {
      // Jeśli wystąpiły błędy, stosuj backoff (zwiększ odstęp)
      const shouldRun = this.consecutiveErrors === 0 || Math.random() > 0.5;
      if (shouldRun) {
        void this.syncNow(false);
      }
    }, this.baseIntervalMs);
  }

  private stopPolling() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public destroy() {
    this.stopPolling();
    if (this.abortController) {
      this.abortController.abort();
    }
  }
}
