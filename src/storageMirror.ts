/**
 * Phase 1 of moving the local copy to IndexedDB (docs/indexeddb-migration.md):
 * localStorage stays the source of truth, and a mirror keeps an identical copy
 * of every NutriApp key somewhere else. The mirror never deletes, and nothing
 * here ever changes what localStorage holds or how its writes fail.
 */

/** Where the mirror keeps its copy (IndexedDB in the app, storageMirrorIdb.ts). */
export interface MirrorBackend {
  /**
   * Stores what `read` returns, under `key`, unless it returns null. `read`
   * runs right before the write goes out, with nothing awaited in between, so
   * the mirror always ends on the latest value even with several tabs writing.
   */
  put(key: string, read: () => string | null): Promise<void>;
  /** Every record the mirror holds. */
  getAll(): Promise<Map<string, string>>;
}

export interface MirrorReport {
  /** The mirrored keys localStorage held when the check ran. */
  keys: number;
  /** Keys the launch copy had to write (missing or different in the mirror). */
  copied: number;
  /** localStorage keys whose mirrored value is missing or not identical. */
  mismatched: string[];
  /** Keys the mirror still keeps after localStorage dropped them. */
  onlyInMirror: string[];
  /** Characters (keys + values) of the mirrored keys in localStorage. */
  chars: number;
  checkedAt: string;
}

/**
 * The keys the mirror copies: NutriApp's, except the food form's drafts. The
 * form writes those straight to localStorage and deletes them once saved, so
 * a copy would outlive them (the mirror never deletes) and they are only
 * worth keeping on the page that wrote them.
 */
export function isMirroredKey(key: string): boolean {
  return key.startsWith("nutriapp") && !key.startsWith("nutriapp:food-form-draft:");
}

export type MirrorState =
  | { status: "checking" }
  | { status: "identical"; report: MirrorReport }
  | { status: "different"; report: MirrorReport }
  | { status: "failed"; error: string };

function keysOf(storage: Storage, isMirrored: (key: string) => boolean): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key != null && isMirrored(key)) keys.push(key);
  }
  return keys;
}

/**
 * The `Storage` the sync engine writes through: localStorage itself, plus a
 * copy of each write to a mirrored key in the backend. A write to `base`
 * succeeds or throws exactly as it would without the mirror; a failing mirror
 * is reported to `onError` and never reaches the caller.
 */
export class MirroredStorage implements Storage {
  private queue: Promise<void> = Promise.resolve();
  /** Keys with a mirror write queued that has not read its value yet. */
  private readonly queued = new Set<string>();

  constructor(
    private readonly base: Storage,
    private readonly backend: MirrorBackend,
    private readonly isMirrored: (key: string) => boolean,
    private readonly onError: (error: unknown) => void = () => {},
  ) {}

  get length(): number {
    return this.base.length;
  }

  key(index: number): string | null {
    return this.base.key(index);
  }

  getItem(key: string): string | null {
    return this.base.getItem(key);
  }

  setItem(key: string, value: string): void {
    try {
      this.base.setItem(key, value);
    } finally {
      // Also after a failed write: the mirror copies what localStorage holds,
      // whichever value that is.
      this.mirror(key);
    }
  }

  /** Removes the key from localStorage only: the mirror keeps its last value. */
  removeItem(key: string): void {
    this.base.removeItem(key);
  }

  clear(): void {
    // Every app on the origin shares this storage (CLAUDE.md).
    throw new Error("NutriApp never clears the shared origin's storage.");
  }

  /** Queues a copy of `key`'s current value; one queued copy per key is enough. */
  mirror(key: string): void {
    if (!this.isMirrored(key) || this.queued.has(key)) return;
    this.queued.add(key);
    this.queue = this.queue.then(() =>
      this.backend
        .put(key, () => {
          this.queued.delete(key);
          return this.base.getItem(key);
        })
        .catch((error: unknown) => {
          this.queued.delete(key);
          this.onError(error);
        }),
    );
  }

  /** Resolves once every queued mirror write has gone out. */
  flush(): Promise<void> {
    return this.queue;
  }

  /**
   * The launch copy: writes every mirrored key the backend lacks or holds
   * differently, then reads everything back and compares it string for
   * string with localStorage.
   */
  async copyAndVerify(now: () => Date = () => new Date()): Promise<MirrorReport> {
    const before = await this.backend.getAll();
    let copied = 0;
    for (const key of keysOf(this.base, this.isMirrored)) {
      if (before.get(key) === this.base.getItem(key)) continue;
      copied += 1;
      this.mirror(key);
    }
    await this.flush();
    let report = await this.compare(copied, now);
    // A write that landed while the check read the mirror is still on its
    // way there: one more round once it has gone out.
    if (report.mismatched.length > 0) {
      await this.flush();
      report = await this.compare(copied, now);
    }
    return report;
  }

  private async compare(copied: number, now: () => Date): Promise<MirrorReport> {
    const after = await this.backend.getAll();
    const keys = keysOf(this.base, this.isMirrored);
    const present = new Set(keys);
    let chars = 0;
    const mismatched: string[] = [];
    for (const key of keys) {
      const value = this.base.getItem(key);
      if (value == null) continue;
      chars += key.length + value.length;
      if (after.get(key) !== value) mismatched.push(key);
    }
    const onlyInMirror = [...after.keys()].filter((key) => !present.has(key)).sort();
    return {
      keys: keys.length,
      copied,
      mismatched: mismatched.sort(),
      onlyInMirror,
      chars,
      checkedAt: now().toISOString(),
    };
  }
}
