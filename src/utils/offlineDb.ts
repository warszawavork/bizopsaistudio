import type { ChatMessage, KnowledgeTile, WorkspaceDataKey } from '../types';

const DB_NAME = 'bizops_offline_db_v1';
const DB_VERSION = 2;
const STORE_TILES = 'tiles_store';
const STORE_QUEUE = 'sync_queue';
const STORE_CHAT = 'chat_store';
const STORE_WORKSPACE = 'workspace_store';

export interface SyncQueueItem {
  id: string;
  type: 'push_tiles' | 'log_ai' | 'save_workspace';
  presetId: string;
  tiles?: KnowledgeTile[];
  deletedIds?: string[];
  authorName?: string;
  logPayload?: Record<string, unknown>;
  dataKey?: WorkspaceDataKey;
  payload?: unknown;
  createdAt: number;
}

export async function idbGetWorkspaceItem<T>(
  presetId: string,
  dataKey: WorkspaceDataKey,
): Promise<{ payload: T; updatedAt: number } | null> {
  try {
    const db = await openOfflineDb();
    if (!db) return null;
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_WORKSPACE, 'readonly');
      const store = tx.objectStore(STORE_WORKSPACE);
      const req = store.get(`${presetId}:${dataKey}`);
      req.onsuccess = () => {
        const res = req.result as { key: string; payload: T; updatedAt: number } | undefined;
        resolve(res ? { payload: res.payload, updatedAt: res.updatedAt } : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function idbSaveWorkspaceItem<T>(
  presetId: string,
  dataKey: WorkspaceDataKey,
  payload: T,
): Promise<void> {
  try {
    const db = await openOfflineDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_WORKSPACE, 'readwrite');
      const store = tx.objectStore(STORE_WORKSPACE);
      store.put({
        key: `${presetId}:${dataKey}`,
        presetId,
        dataKey,
        payload,
        updatedAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Non-blocking fallback
  }
}

export async function idbEnqueueWorkspaceSave(
  presetId: string,
  dataKey: WorkspaceDataKey,
  payload: unknown,
  authorName?: string,
): Promise<number> {
  try {
    const db = await openOfflineDb();
    if (!db) return 0;
    const item: SyncQueueItem = {
      id: `ws_${presetId}_${dataKey}`,
      type: 'save_workspace',
      presetId,
      dataKey,
      payload,
      authorName,
      createdAt: Date.now(),
    };
    return await new Promise<number>((resolve) => {
      const tx = db.transaction(STORE_QUEUE, 'readwrite');
      const store = tx.objectStore(STORE_QUEUE);
      store.put(item);
      tx.oncomplete = () => {
        try {
          const countTx = db.transaction(STORE_QUEUE, 'readonly');
          const countReq = countTx.objectStore(STORE_QUEUE).count();
          countReq.onsuccess = () => resolve(countReq.result ?? 0);
          countReq.onerror = () => resolve(0);
        } catch {
          resolve(0);
        }
      };
      tx.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}

interface StoredTilesRecord {
  presetId: string;
  tiles: KnowledgeTile[];
  updatedAt: string;
}

interface StoredChatRecord {
  presetId: string;
  messages: ChatMessage[];
  updatedAt: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openOfflineDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_TILES)) {
          db.createObjectStore(STORE_TILES, { keyPath: 'presetId' });
        }
        if (!db.objectStoreNames.contains(STORE_QUEUE)) {
          db.createObjectStore(STORE_QUEUE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_CHAT)) {
          db.createObjectStore(STORE_CHAT, { keyPath: 'presetId' });
        }
        if (!db.objectStoreNames.contains(STORE_WORKSPACE)) {
          db.createObjectStore(STORE_WORKSPACE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

async function runStoreRequest<T>(
  storeName: string,
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  const db = await openOfflineDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const request = executor(store);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Odczytuje kafelki z IndexedDB (brak limitu 5 MB jak w localStorage).
 */
export async function idbGetTiles(presetId: string): Promise<KnowledgeTile[] | null> {
  const record = await runStoreRequest<StoredTilesRecord>(STORE_TILES, 'readonly', (s) =>
    s.get(presetId)
  );
  return record && Array.isArray(record.tiles) ? record.tiles : null;
}

export async function idbSaveTiles(presetId: string, tiles: KnowledgeTile[]): Promise<void> {
  await runStoreRequest(STORE_TILES, 'readwrite', (s) =>
    s.put({
      presetId,
      tiles,
      updatedAt: new Date().toISOString(),
    } satisfies StoredTilesRecord)
  );
}

export async function idbGetChatMessages(presetId: string): Promise<ChatMessage[] | null> {
  const record = await runStoreRequest<StoredChatRecord>(STORE_CHAT, 'readonly', (s) =>
    s.get(presetId)
  );
  return record && Array.isArray(record.messages) ? record.messages : null;
}

export async function idbSaveChatMessages(
  presetId: string,
  messages: ChatMessage[]
): Promise<void> {
  await runStoreRequest(STORE_CHAT, 'readwrite', (s) =>
    s.put({
      presetId,
      messages: messages.slice(-60),
      updatedAt: new Date().toISOString(),
    } satisfies StoredChatRecord)
  );
}

export async function idbGetQueue(): Promise<SyncQueueItem[]> {
  const items = await runStoreRequest<SyncQueueItem[]>(STORE_QUEUE, 'readonly', (s) => s.getAll());
  if (!Array.isArray(items)) return [];
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

export async function idbGetQueueCount(): Promise<number> {
  const count = await runStoreRequest<number>(STORE_QUEUE, 'readonly', (s) => s.count());
  return typeof count === 'number' ? count : 0;
}

/**
 * Dodaje operację zapisu/usunięcia kafelków do trwałej kolejki offline SyncQueue.
 * Scala wielokrotne edycje offline tego samego profilu, zachowując listę usunięć.
 */
export async function idbEnqueueTilePush(
  presetId: string,
  tiles: KnowledgeTile[],
  deletedIds: string[],
  authorName: string
): Promise<number> {
  const queueId = `push_tiles_${presetId}`;
  const existing = await runStoreRequest<SyncQueueItem>(STORE_QUEUE, 'readonly', (s) =>
    s.get(queueId)
  );
  const currentIds = new Set(tiles.map((t) => t.id));
  const mergedDeleted = Array.from(
    new Set([...(existing?.deletedIds || []), ...deletedIds])
  ).filter((id) => !currentIds.has(id));

  const item: SyncQueueItem = {
    id: queueId,
    type: 'push_tiles',
    presetId,
    tiles,
    deletedIds: mergedDeleted,
    authorName,
    createdAt: existing?.createdAt ?? Date.now(),
  };

  await runStoreRequest(STORE_QUEUE, 'readwrite', (s) => s.put(item));
  return idbGetQueueCount();
}

export async function idbEnqueueAiLog(logPayload: Record<string, unknown>): Promise<number> {
  const id = `log_ai_${String(logPayload.id || Date.now())}`;
  const item: SyncQueueItem = {
    id,
    type: 'log_ai',
    presetId: String(logPayload.presetName || 'global'),
    logPayload,
    createdAt: Date.now(),
  };
  await runStoreRequest(STORE_QUEUE, 'readwrite', (s) => s.put(item));
  return idbGetQueueCount();
}

export async function idbRemoveQueueItem(id: string): Promise<number> {
  await runStoreRequest(STORE_QUEUE, 'readwrite', (s) => s.delete(id));
  return idbGetQueueCount();
}
