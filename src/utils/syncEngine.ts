import type { KnowledgeTile } from '../types';
import {
  deleteCloudTile,
  fetchCloudAiStats,
  fetchCloudTiles,
  recordCloudAiLog,
  saveBatchCloudTiles,
  saveCloudTile,
} from './apiClient';
import {
  idbEnqueueAiLog,
  idbEnqueueTilePush,
  idbGetQueue,
  idbGetQueueCount,
  idbGetTiles,
  idbRemoveQueueItem,
  idbSaveTiles,
} from './offlineDb';

export type SyncState = 'connected' | 'syncing' | 'offline' | 'queued' | 'error';

export interface CloudAiLogItem {
  id: string;
  timestamp: string;
  action: string;
  presetName: string;
  model: string;
  latencyMs: number;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  status: string;
  summary: string;
  userName?: string;
}

export interface AutoRetentionStats {
  retentionDays: number;
  thresholdPercent: number;
  storageUsagePercent: number;
  pressureWarning: boolean;
  lastPrunedCount: number;
  autoPrunedThisRequest?: boolean;
}

export interface SyncStats {
  todayRequests: number;
  todayTokens: number;
  avgLatency: number;
  minuteRequests?: number;
  minuteTokens?: number;
  dbSizeBytes?: number;
  maxStorageBytes?: number;
  tilesCount?: number;
  logsCount?: number;
  recentLogs?: CloudAiLogItem[];
  autoRetention?: AutoRetentionStats;
}

export interface SyncEngineListeners {
  onStatusChange?: (status: SyncState) => void;
  onTilesUpdated?: (presetId: string, tiles: KnowledgeTile[]) => void;
  onStatsUpdated?: (stats: SyncStats) => void;
  onQueueChange?: (pendingCount: number) => void;
  onQueueFlushed?: (flushedCount: number) => void;
  onRollback?: (presetId: string, previousTiles: KnowledgeTile[], reason: string) => void;
  onError?: (err: Error) => void;
}

function tilesEqual(a: KnowledgeTile, b: KnowledgeTile): boolean {
  return (
    a.content === b.content &&
    a.title === b.title &&
    a.category === b.category &&
    a.enabled === b.enabled &&
    a.priority === b.priority &&
    a.visibility === b.visibility &&
    a.updatedAt === b.updatedAt
  );
}

function isTransientNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /failed to fetch|networkerror|load failed|abort|timeout|http 502|http 503|http 504/i.test(msg);
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

  const hasDeletions = local.some((t) => !remoteMap.has(t.id));
  const hasAdditions = remote.some((t) => !localMap.has(t.id));
  const hasUpdates = remote.some((rt) => {
    const loc = localMap.get(rt.id);
    return loc ? !tilesEqual(loc, rt) : false;
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
  private isFlushing = false;
  private abortController: AbortController | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private consecutiveErrors = 0;
  private lastWriteTimestamp = 0;
  private baseIntervalMs = 5000;
  private isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

  private handleOnline = () => {
    this.isOnline = true;
    this.consecutiveErrors = 0;
    void this.syncNow(false);
  };

  private handleOffline = () => {
    this.isOnline = false;
    this.updateStatus('offline');
  };

  private handleVisibility = () => {
    if (document.visibilityState === 'visible' && this.isOnline) {
      void this.syncNow(false);
    }
  };

  constructor(initialPresetId: string, initialTiles: KnowledgeTile[], listeners: SyncEngineListeners) {
    this.activePresetId = initialPresetId;
    this.localTiles = initialTiles;
    this.listeners = listeners;
    if (!this.isOnline) {
      this.status = 'offline';
    }

    this.setupNetworkListeners();
    void this.hydrateFromIndexedDb(initialPresetId);
    this.startPolling();
  }

  private async hydrateFromIndexedDb(presetId: string): Promise<void> {
    const [cachedTiles, queueCount] = await Promise.all([
      idbGetTiles(presetId),
      idbGetQueueCount(),
    ]);

    if (this.activePresetId !== presetId) return;

    this.listeners.onQueueChange?.(queueCount);
    if (queueCount > 0 && !this.isOnline) {
      this.updateStatus('offline');
    } else if (queueCount > 0) {
      this.updateStatus('queued');
    }

    if (cachedTiles && diffTiles(this.localTiles, cachedTiles).isDifferent) {
      this.localTiles = cachedTiles;
      this.listeners.onTilesUpdated?.(presetId, cachedTiles);
    }

    if (this.isOnline) {
      void this.syncNow(true);
    }
  }

  private setupNetworkListeners() {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    document.addEventListener('visibilitychange', this.handleVisibility);
  }

  public setPreset(newPresetId: string, newTiles: KnowledgeTile[]) {
    if (this.activePresetId === newPresetId) return;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.activePresetId = newPresetId;
    this.localTiles = newTiles;
    this.consecutiveErrors = 0;
    void this.hydrateFromIndexedDb(newPresetId);
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

  public async enqueueAiLogOffline(logPayload: Record<string, unknown>): Promise<void> {
    const remaining = await idbEnqueueAiLog(logPayload);
    this.listeners.onQueueChange?.(remaining);
    if (!this.isOnline) {
      this.updateStatus('offline');
    } else if (remaining > 0) {
      this.updateStatus('queued');
    }
  }

  public async flushQueue(): Promise<{ flushed: number; remaining: number }> {
    if (!this.isOnline || this.isFlushing) {
      return { flushed: 0, remaining: await idbGetQueueCount() };
    }

    this.isFlushing = true;
    let flushed = 0;

    try {
      const queue = await idbGetQueue();
      if (queue.length === 0) {
        this.listeners.onQueueChange?.(0);
        return { flushed: 0, remaining: 0 };
      }

      this.updateStatus('syncing');

      for (const item of queue) {
        if (item.type === 'push_tiles' && item.tiles) {
          const deleted = item.deletedIds || [];
          if (deleted.length > 0) {
            await Promise.all(deleted.map((id) => deleteCloudTile(id)));
          }
          await saveBatchCloudTiles(item.tiles, item.presetId, item.authorName || 'Zespół (Offline Sync)');
          await idbRemoveQueueItem(item.id);
          flushed++;
        } else if (item.type === 'log_ai' && item.logPayload) {
          await recordCloudAiLog(item.logPayload);
          await idbRemoveQueueItem(item.id);
          flushed++;
        }
      }

      const remaining = await idbGetQueueCount();
      this.listeners.onQueueChange?.(remaining);
      if (flushed > 0) {
        this.listeners.onQueueFlushed?.(flushed);
      }
      return { flushed, remaining };
    } catch (err) {
      const remaining = await idbGetQueueCount();
      this.listeners.onQueueChange?.(remaining);
      if (isTransientNetworkError(err)) {
        this.updateStatus(this.isOnline ? 'queued' : 'offline');
      }
      return { flushed, remaining };
    } finally {
      this.isFlushing = false;
    }
  }

  public async syncNow(isInitial = false): Promise<void> {
    if (!this.isOnline) {
      this.updateStatus('offline');
      return;
    }

    if (this.isSyncing) return;

    this.isSyncing = true;
    const currentPreset = this.activePresetId;
    const syncStartedAt = Date.now();

    try {
      // 1. Najpierw wypchnij zaległą kolejkę offline (aby nie nadpisać lokalnych zmian starym stanem z serwera)
      const { remaining } = await this.flushQueue();
      if (remaining > 0) {
        // W kolejce wciąż są niewypchnięte zmiany — nie nadpisuj ich z serwera
        this.updateStatus('queued');
        return;
      }

      this.abortController = new AbortController();
      const signal = this.abortController.signal;

      const [res, statsRes] = await Promise.all([
        fetchCloudTiles(currentPreset, signal),
        fetchCloudAiStats(signal).catch(() => null),
      ]);

      if (statsRes && statsRes.success && statsRes.stats) {
        this.listeners.onStatsUpdated?.({
          ...statsRes.stats,
          recentLogs: statsRes.logs || [],
        });
      }

      // Guard: profil zmieniony w trakcie zapytania lub nastąpił nowszy optymistyczny zapis lokalny
      if (this.activePresetId !== currentPreset || this.lastWriteTimestamp > syncStartedAt) {
        return;
      }

      if (!res.success) throw new Error('Serwer zwrócił niepowodzenie');

      const serverTiles = (res.tiles || []) as KnowledgeTile[];

      // Inicjalizacja pustej bazy Neon danymi lokalnymi
      if (serverTiles.length === 0 && this.localTiles.length > 0) {
        await saveBatchCloudTiles(this.localTiles, currentPreset, 'Inicjalizacja');
        void idbSaveTiles(currentPreset, this.localTiles);
        this.updateStatus('connected');
        this.consecutiveErrors = 0;
        return;
      }

      const diff = diffTiles(this.localTiles, serverTiles);

      if (isInitial && this.localTiles.length > serverTiles.length && !diff.hasDeletions) {
        await saveBatchCloudTiles(this.localTiles, currentPreset, 'Inicjalizacja');
        void idbSaveTiles(currentPreset, this.localTiles);
        this.updateStatus('connected');
        this.consecutiveErrors = 0;
        return;
      }

      if (diff.isDifferent) {
        this.localTiles = serverTiles;
        void idbSaveTiles(currentPreset, serverTiles);
        this.listeners.onTilesUpdated?.(currentPreset, serverTiles);
      }

      this.updateStatus('connected');
      this.consecutiveErrors = 0;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      if (isTransientNetworkError(err)) {
        const pending = await idbGetQueueCount();
        this.updateStatus(pending > 0 ? 'queued' : navigator.onLine ? 'error' : 'offline');
      } else {
        this.consecutiveErrors++;
        if (this.consecutiveErrors >= 3) {
          this.updateStatus('error');
        }
      }
      this.listeners.onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.isSyncing = false;
      this.abortController = null;
    }
  }

  /**
   * Optymistyczny zapis kafelków:
   * - Zapis natychmiastowy do IndexedDB (0 ms)
   * - Delta sync (tylko zmienione lub usunięte kafelki) przy sieci
   * - Kolejkowanie do IndexedDB SyncQueue przy braku internetu
   * - Rollback stanu w razie odrzucenia przez serwer
   */
  public async pushTiles(
    newTiles: KnowledgeTile[],
    authorName: string
  ): Promise<{ deletedCount: number; mode: 'synced' | 'queued' | 'rolled_back' }> {
    const presetAtCall = this.activePresetId;
    const previousTiles = [...this.localTiles];
    const prevMap = new Map(previousTiles.map((t) => [t.id, t]));
    const nextMap = new Map(newTiles.map((t) => [t.id, t]));

    const deletedTiles = previousTiles.filter((t) => !nextMap.has(t.id));
    const addedOrUpdatedTiles = newTiles.filter((t) => {
      const prev = prevMap.get(t.id);
      return !prev || !tilesEqual(prev, t);
    });

    this.lastWriteTimestamp = Date.now();
    this.localTiles = newTiles;

    // Anuluj ewentualny równoległy odczyt tła, aby nie cofnął optymistycznej zmiany
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // 1. Natychmiastowy zapis lokalny w IndexedDB (Offline-First)
    void idbSaveTiles(presetAtCall, newTiles);

    // 2. Jeśli jesteśmy offline — dodaj do SyncQueue zamiast rzucać błąd
    if (!this.isOnline) {
      const count = await idbEnqueueTilePush(
        presetAtCall,
        newTiles,
        deletedTiles.map((d) => d.id),
        authorName
      );
      this.listeners.onQueueChange?.(count);
      this.updateStatus('offline');
      return { deletedCount: deletedTiles.length, mode: 'queued' };
    }

    this.updateStatus('syncing');

    try {
      // Wypchnij najpierw ew. poprzednie elementy kolejki dla zachowania kolejności zdarzeń
      await this.flushQueue();

      if (deletedTiles.length > 0 && addedOrUpdatedTiles.length === 0 && newTiles.length > 0) {
        // Szybka ścieżka: samo usunięcie pojedynczych kafelków
        await Promise.all(deletedTiles.map((del) => deleteCloudTile(del.id)));
      } else if (
        deletedTiles.length === 0 &&
        addedOrUpdatedTiles.length > 0 &&
        addedOrUpdatedTiles.length <= 3
      ) {
        // Szybka ścieżka: pojedynczy upsert 1-3 kafelków bez przepisywania całej bazy
        await Promise.all(
          addedOrUpdatedTiles.map((t) => saveCloudTile(t, presetAtCall, authorName))
        );
      } else {
        // Pełna ścieżka wsadowa dla masowych zmian / importu / resetu
        if (deletedTiles.length > 0) {
          await Promise.all(deletedTiles.map((del) => deleteCloudTile(del.id)));
        }
        await saveBatchCloudTiles(newTiles, presetAtCall, authorName);
      }

      this.updateStatus('connected');
      this.consecutiveErrors = 0;
      return { deletedCount: deletedTiles.length, mode: 'synced' };
    } catch (err) {
      if (isTransientNetworkError(err)) {
        const count = await idbEnqueueTilePush(
          presetAtCall,
          newTiles,
          deletedTiles.map((d) => d.id),
          authorName
        );
        this.listeners.onQueueChange?.(count);
        this.updateStatus(this.isOnline ? 'queued' : 'offline');
        return { deletedCount: deletedTiles.length, mode: 'queued' };
      }

      // Twardy błąd serwera (np. HTTP 400 walidacja) -> Optymistyczny Rollback
      const reason = err instanceof Error ? err.message : 'Błąd zapisu w bazie Neon';
      if (this.activePresetId === presetAtCall) {
        this.localTiles = previousTiles;
      }
      void idbSaveTiles(presetAtCall, previousTiles);
      this.updateStatus('error');
      this.listeners.onRollback?.(presetAtCall, previousTiles, reason);
      return { deletedCount: 0, mode: 'rolled_back' };
    }
  }

  private startPolling() {
    this.stopPolling();
    this.timer = setInterval(() => {
      if (!this.isOnline) return;
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
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
      document.removeEventListener('visibilitychange', this.handleVisibility);
    }
    if (this.abortController) {
      this.abortController.abort();
    }
  }
}
