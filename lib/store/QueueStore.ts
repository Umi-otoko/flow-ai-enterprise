/**
 * QueueStore — two-tier persistence strategy:
 *
 * 1. chrome.storage.local  — shared between SW, content scripts, and popup.
 *    Used for the full ExtensionState snapshot (queue, botState, settings).
 *    Survives SW termination; the SW re-hydrates from here on every wake-up.
 *
 * 2. IndexedDB (extension origin, SW-side only) — used for large/growing
 *    collections: gallery thumbnails and activity logs.
 *    Provides cursor-based pagination and indexed queries without hitting
 *    the 10 MB chrome.storage.local cap.
 *
 * Why not IndexedDB for everything?
 *   Content scripts run in the PAGE's origin, so their IndexedDB is isolated
 *   from the extension's. Using chrome.storage.local as the shared bus avoids
 *   a cross-origin messaging layer for every state read.
 */

import type { ExtensionState, GeneratedImage, LogEntry } from '../../utils/types';

const STATE_KEY   = 'flow_ext_state_v3';
const MAX_GALLERY = 60;
const MAX_LOGS    = 120;

export const DEFAULT_STATE: ExtensionState = {
  botState:      'IDLE',
  queue:         [],
  gallery:       [],
  logs:          [],
  isRunning:     false,
  isPaused:      false,
  activeTabId:   null,
  activeSceneId: null,
  projectName:   'Campaign',
  apiSource:     'json',
  localApiUrl:   'ws://localhost:8000/ws/prompts',
  backoffAttempt: 0,
  nextRetryAt:   0,
  lastUpdated:   Date.now(),
};

// ─── chrome.storage.local (shared state bus) ──────────────────────────────────

export class QueueStore {
  static async load(): Promise<ExtensionState> {
    const res = await chrome.storage.local.get(STATE_KEY);
    const stored = res[STATE_KEY] as Partial<ExtensionState> | undefined;
    return stored ? { ...DEFAULT_STATE, ...stored } : { ...DEFAULT_STATE };
  }

  static async save(patch: Partial<ExtensionState>): Promise<void> {
    const current = await QueueStore.load();
    await chrome.storage.local.set({
      [STATE_KEY]: { ...current, ...patch, lastUpdated: Date.now() },
    });
  }

  static async clear(): Promise<void> {
    await chrome.storage.local.remove(STATE_KEY);
  }
}

// ─── IndexedDB (gallery + logs — SW origin only) ─────────────────────────────

const DB_NAME    = 'FlowAI_v1';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('gallery')) {
        const gs = db.createObjectStore('gallery', { keyPath: 'id' });
        gs.createIndex('sceneNumber', 'sceneNumber');
        gs.createIndex('downloadedAt', 'downloadedAt');
      }
      if (!db.objectStoreNames.contains('logs')) {
        const ls = db.createObjectStore('logs', { keyPath: 'id' });
        ls.createIndex('timestamp', 'timestamp');
        ls.createIndex('level', 'level');
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function idbPut(storeName: string, record: object): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx  = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).put(record);
        req.onsuccess = () => resolve();
        req.onerror   = () => reject(req.error);
      }),
  );
}

function idbGetAll<T>(storeName: string, limit?: number): Promise<T[]> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx      = db.transaction(storeName, 'readonly');
        const store   = tx.objectStore(storeName);
        const results: T[] = [];
        let count = 0;

        const req = store.openCursor(null, 'prev'); // newest first
        req.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
          if (!cursor || (limit && count >= limit)) {
            resolve(results);
            return;
          }
          results.push(cursor.value as T);
          count++;
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
      }),
  );
}

function idbCount(storeName: string): Promise<number> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(storeName, 'readonly').objectStore(storeName).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
      }),
  );
}

async function idbTrimOldest(storeName: string, maxRecords: number): Promise<void> {
  const total = await idbCount(storeName);
  if (total <= maxRecords) return;

  const db     = await openDB();
  const excess = total - maxRecords;

  await new Promise<void>((resolve, reject) => {
    let deleted = 0;
    const tx    = db.transaction(storeName, 'readwrite');
    const req   = tx.objectStore(storeName).openCursor(); // oldest first (default)

    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (!cursor || deleted >= excess) { resolve(); return; }
      cursor.delete();
      deleted++;
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

// ─── Public IndexedDB helpers ─────────────────────────────────────────────────

export async function idbPushGallery(image: GeneratedImage): Promise<void> {
  await idbPut('gallery', image);
  await idbTrimOldest('gallery', MAX_GALLERY);
}

export async function idbGetGallery(limit = MAX_GALLERY): Promise<GeneratedImage[]> {
  return idbGetAll<GeneratedImage>('gallery', limit);
}

export async function idbPushLog(entry: Omit<LogEntry, 'id' | 'timestamp'>): Promise<void> {
  const record: LogEntry = { id: crypto.randomUUID(), timestamp: Date.now(), ...entry };
  await idbPut('logs', record);
  await idbTrimOldest('logs', MAX_LOGS);
}

export async function idbGetLogs(limit = 50): Promise<LogEntry[]> {
  return idbGetAll<LogEntry>('logs', limit);
}
