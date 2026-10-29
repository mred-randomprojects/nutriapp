/**
 * How much of the origin's IndexedDB/Cache quota is used, and how much of it
 * is NutriApp's own databases. The browser's numbers are the whole origin's:
 * every app on mred-randomprojects.github.io shares them (CLAUDE.md).
 */
import { approximateBytes } from "./storageQuota";

export interface OriginEstimate {
  usage: number;
  quota: number;
}

/** The browser's estimate for the whole origin; null where it has none. */
export async function estimateOrigin(): Promise<OriginEstimate | null> {
  if (typeof navigator === "undefined" || navigator.storage?.estimate == null) return null;
  const { usage, quota } = await navigator.storage.estimate();
  if (usage == null || quota == null) return null;
  return { usage, quota };
}

/** NutriApp's databases (safetyStore.ts, storageMirrorIdb.ts). */
export const NUTRIAPP_DATABASES = ["nutriapp-storage", "nutriapp-safety"] as const;

/**
 * The approximate size of one database, by reading every record. Zero when
 * the database does not exist; it is never created here.
 */
export function measureDatabase(name: string): Promise<number> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = indexedDB.open(name);
    let missing = false;
    request.onupgradeneeded = () => {
      // Opening without a version only upgrades a database that is not
      // there: abort, so measuring never creates one.
      missing = true;
      request.transaction?.abort();
    };
    request.onerror = () => {
      if (missing) resolve(0);
      else reject(request.error ?? new Error("IndexedDB open failed"));
    };
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
    request.onsuccess = () => {
      const db = request.result;
      const stores = [...db.objectStoreNames];
      if (stores.length === 0) {
        db.close();
        resolve(0);
        return;
      }
      let bytes = 0;
      const tx = db.transaction(stores, "readonly");
      for (const store of stores) {
        const cursor = tx.objectStore(store).openCursor();
        cursor.onsuccess = () => {
          const at = cursor.result;
          if (at == null) return;
          bytes += approximateBytes(at.key, at.value);
          at.continue();
        };
      }
      tx.oncomplete = () => {
        db.close();
        resolve(bytes);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error ?? new Error("IndexedDB read failed"));
      };
    };
  });
}
