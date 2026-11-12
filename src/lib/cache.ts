import type { IndexDataset, Snapshot } from './types';

const DB_NAME = 'mss-dashboard';
const DB_VERSION = 2;
const SNAPSHOT_STORE = 'snapshots';
const DATASET_STORE = 'datasets';
const KEY = 'latest';

type CacheRecord = {
  version: string;
  savedAt: number;
  snapshot: Snapshot;
};

type DatasetRecord = {
  savedAt: number;
  dataset: IndexDataset;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE);
      }
      if (!db.objectStoreNames.contains(DATASET_STORE)) {
        db.createObjectStore(DATASET_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function datasetKey(version: string, key: string): string {
  return `${version}|${key}`;
}

/** Best-effort read of the last snapshot; never throws. */
export async function readCachedSnapshot(): Promise<Snapshot | null> {
  try {
    const db = await openDb();
    const record = await new Promise<CacheRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(SNAPSHOT_STORE, 'readonly');
      const request = tx.objectStore(SNAPSHOT_STORE).get(KEY);
      request.onsuccess = () => resolve(request.result as CacheRecord | undefined);
      request.onerror = () => reject(request.error);
    });
    db.close();
    const snapshot = record?.snapshot;
    // Discard snapshots from before the API-backed catalogue refactor.
    if (
      !snapshot ||
      !Array.isArray(snapshot.catalogue) ||
      !Array.isArray(snapshot.indices) ||
      typeof snapshot.historyFrom !== 'string'
    ) {
      return null;
    }
    return snapshot;
  } catch {
    return null;
  }
}

/** Best-effort write; quota or private-mode failures are ignored. */
export async function writeCachedSnapshot(snapshot: Snapshot): Promise<boolean> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
      const record: CacheRecord = {
        version: snapshot.version,
        savedAt: Date.now(),
        snapshot,
      };
      tx.objectStore(SNAPSHOT_STORE).put(record, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

/** Read a lazily loaded index, but only if it matches the core snapshot. */
export async function readCachedDataset(
  version: string,
  key: string,
): Promise<IndexDataset | null> {
  try {
    const db = await openDb();
    const record = await new Promise<DatasetRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(DATASET_STORE, 'readonly');
      const request = tx
        .objectStore(DATASET_STORE)
        .get(datasetKey(version, key));
      request.onsuccess = () => resolve(request.result as DatasetRecord | undefined);
      request.onerror = () => reject(request.error);
    });
    db.close();
    const dataset = record?.dataset;
    if (!dataset || dataset.version !== version || dataset.index.key !== key) {
      return null;
    }
    return dataset;
  } catch {
    return null;
  }
}

export async function writeCachedDataset(dataset: IndexDataset): Promise<boolean> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DATASET_STORE, 'readwrite');
      const record: DatasetRecord = { savedAt: Date.now(), dataset };
      tx.objectStore(DATASET_STORE).put(
        record,
        datasetKey(dataset.version, dataset.index.key),
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}
