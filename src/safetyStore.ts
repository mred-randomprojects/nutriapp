import type { SafetyCopy } from "./dataLoss";
import { parseAppData } from "./storage";
import type { SafetyStore } from "./syncEngine";

/**
 * The safety copy in IndexedDB, one record per account. Not localStorage:
 * the copy is as big as the data, and the 5 MB there are shared by every app
 * on the origin. The database is named after the app, as every app on the
 * shared origin must (see CLAUDE.md).
 */
const DB_NAME = "nutriapp-safety";
const STORE = "copies";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = act(tx.objectStore(STORE));
        let result: T;
        request.onsuccess = () => {
          result = request.result;
        };
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error("IndexedDB transaction failed"));
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error("IndexedDB transaction aborted"));
        };
      }),
  );
}

/** A stored record as a safety copy, normalized like a local copy; null when it is not one. */
function toSafetyCopy(value: unknown): SafetyCopy | null {
  if (value == null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.savedAt !== "string") return null;
  const data = parseAppData(JSON.stringify(record.data ?? null));
  return data == null ? null : { savedAt: record.savedAt, data };
}

export const indexedDbSafetyStore: SafetyStore = {
  async load(uid) {
    const value: unknown = await run("readonly", (store) => store.get(uid));
    return toSafetyCopy(value);
  },
  async save(uid, copy) {
    try {
      await run("readwrite", (store) => store.put(copy, uid));
      return true;
    } catch {
      return false;
    }
  },
  async clear(uid) {
    await run("readwrite", (store) => store.delete(uid));
  },
};
