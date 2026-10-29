import {
  MirroredStorage,
  isMirroredKey,
  type MirrorBackend,
  type MirrorState,
} from "./storageMirror";

/**
 * The mirror of NutriApp's localStorage keys in IndexedDB (phase 1 of
 * docs/indexeddb-migration.md): one record per key, holding the exact string.
 * Named after the app, as every database on the shared origin must be
 * (CLAUDE.md).
 */
const DB_NAME = "nutriapp-storage";
const STORE = "localStorage";

let opening: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgrading the database: let it, and reopen on next use.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
  // A failed open is retried on the next write rather than cached.
  opening.catch(() => {
    opening = null;
  });
  return opening;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export const indexedDbMirrorBackend: MirrorBackend = {
  async put(key, read) {
    const db = await openDb();
    // Read and write in the same task: nothing can land in between.
    const value = read();
    if (value == null) return;
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    await done(tx);
  },
  async getAll() {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const keysRequest = store.getAllKeys();
    const valuesRequest = store.getAll();
    await done(tx);
    const records = new Map<string, string>();
    const values: unknown[] = valuesRequest.result;
    keysRequest.result.forEach((key, i) => {
      const value = values[i];
      if (typeof key === "string" && typeof value === "string") records.set(key, value);
    });
    return records;
  },
};

function logMirror(message: string, detail?: unknown): void {
  if (detail === undefined) console.log(`[storage-mirror] ${message}`);
  else console.log(`[storage-mirror] ${message}`, detail);
}

let mirrored: MirroredStorage | null = null;

/**
 * The Storage the sync engine writes through: localStorage, mirrored. Null
 * when localStorage itself cannot be reached (storage blocked), where the
 * engine goes on as it always has.
 */
export function mirroredLocalStorage(): MirroredStorage | null {
  if (mirrored != null) return mirrored;
  let base: Storage;
  try {
    base = window.localStorage;
  } catch {
    return null;
  }
  mirrored = new MirroredStorage(base, indexedDbMirrorBackend, isMirroredKey, (error) =>
    logMirror("write failed", error),
  );
  return mirrored;
}

let state: MirrorState = { status: "checking" };
const listeners = new Set<() => void>();
let started = false;

function setState(next: MirrorState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** Copies and checks the mirror once per page load. */
export function startStorageMirror(): void {
  if (started) return;
  started = true;
  const storage = mirroredLocalStorage();
  if (storage == null) {
    setState({ status: "failed", error: "localStorage is not available" });
    return;
  }
  storage.copyAndVerify().then(
    (report) => {
      const identical = report.mismatched.length === 0;
      logMirror(identical ? "identical" : "DIFFERENT", report);
      setState({ status: identical ? "identical" : "different", report });
    },
    (error: unknown) => {
      logMirror("check failed", error);
      setState({ status: "failed", error: error instanceof Error ? error.message : String(error) });
    },
  );
}

export function subscribeStorageMirror(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getStorageMirrorState(): MirrorState {
  return state;
}
