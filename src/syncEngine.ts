import type { AppData } from "./types.js";
import {
  loadAppData,
  loadSyncMeta,
  localKeysFor,
  parseAppData,
  saveAppData,
  saveSyncMeta,
  StorageQuotaError,
  type LocalKeys,
  type PendingMark,
} from "./storage.js";
import {
  changedKeys,
  changeFingerprint,
  changeHolds,
  mergeForPull,
  mergeForSave,
  overlay,
  rebase,
  sameData,
  sameTombstoneLists,
  type ChangeKey,
} from "./syncMerge.js";
import { mergeAppData } from "./mergeAppData.js";
import { reconcileTombstonesForRestore } from "./tombstones.js";
import { CLOUD_DOC_LIMIT_BYTES, cloudDocBytes } from "./cloudDoc.js";
import {
  detectDataLoss,
  restoreMissing,
  safetyCopyAfterMerge,
  type DataLoss,
  type SafetyCopy,
} from "./dataLoss.js";

/** Maximum number of undoable actions kept in the session history. */
export const MAX_HISTORY = 50;

/** Shown until a cloud write succeeds again. */
export const CLOUD_SYNC_FAILED = "Sync failed — your changes are saved on this device.";

/** Shown while a write is refused because the cloud copy would pass 1 MiB. */
export const CLOUD_DOC_FULL =
  "Your cloud copy is full (Firestore takes 1 MiB per document): changes stay on this device and no longer reach your other devices. Download a backup from Account.";

const STORAGE_BLOCKED =
  "This browser is not letting NutriApp store data on this device: your changes go to the cloud only.";

/** First retry after a failed pull or save, doubling up to the maximum. */
const RETRY_FIRST_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;

/**
 * Where the latest user change is: still being written, or written. "saved"
 * means it reached the cloud. `at` makes two saves in a row distinct, so the
 * indicator restarts.
 */
export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number };

/**
 * One undoable action. `before`/`after` are full immutable AppData snapshots;
 * thanks to the immutable update style they structurally share everything the
 * action did not touch, so keeping many frames is cheap.
 */
export interface HistoryFrame {
  label: string;
  at: string;
  before: AppData;
  after: AppData;
}

export interface CloudWrite {
  /** The copy the transaction read (null: the document did not exist). */
  cloud: AppData | null;
  /** What it wrote, or null when there was nothing to write. */
  written: AppData | null;
}

/** The cloud copy, as cloudStorage.ts reaches it (a fake in the tests). */
export interface CloudPort {
  load(uid: string): Promise<AppData | null>;
  /** Reads the copy in a transaction and writes what `build` returns (re-run on retries). */
  write(uid: string, build: (cloud: AppData | null) => AppData | null): Promise<CloudWrite>;
}

/** Everything the UI shows, replaced as a whole on every change. */
export interface SyncSnapshot {
  data: AppData;
  undoStack: ReadonlyArray<HistoryFrame>;
  redoStack: ReadonlyArray<HistoryFrame>;
  storageError: string | null;
  cloudError: string | null;
  saveStatus: SaveStatus;
  /** Firestore's size of the cloud copy as last read or written; null until known. */
  cloudBytes: number | null;
  /** What a pull took away from this device, kept until restored or dismissed. */
  safetyCopy: SafetyNotice | null;
}

export interface SafetyNotice {
  savedAt: string;
  /** What the copy holds that this device no longer does. */
  loss: DataLoss;
  /** False when the copy could not be stored: it lasts only while the app stays open. */
  persisted: boolean;
}

/**
 * Where this account's safety copy lives across launches (IndexedDB in the
 * app, safetyStore.ts: the copy is as big as the data, and localStorage is
 * the shared origin's 5 MB).
 */
export interface SafetyStore {
  load(uid: string): Promise<SafetyCopy | null>;
  /** False when it could not be stored. */
  save(uid: string, copy: SafetyCopy): Promise<boolean>;
  clear(uid: string): Promise<void>;
}

export interface SyncEngineOptions {
  uid: string;
  cloud: CloudPort;
  storage?: Storage;
  now?: () => number;
  /** Runs `fn` after `ms` and returns a function that cancels it. */
  schedule?: (fn: () => void, ms: number) => () => void;
  log?: (message: string, detail?: unknown) => void;
  /** Without one, a safety copy lasts only while the app stays open. */
  safety?: SafetyStore;
  /** Tells this tab's stamps from other tabs' (random by default; tests fix it). */
  stampNonce?: string;
}

/** A write refused before it was sent: the document would pass Firestore's limit. */
export class CloudDocTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(`The cloud copy would be ${bytes} bytes, over Firestore's ${CLOUD_DOC_LIMIT_BYTES}.`);
    this.name = "CloudDocTooLargeError";
  }
}

function isTooLarge(err: unknown): boolean {
  if (err instanceof CloudDocTooLargeError) return true;
  return err instanceof Error && /maximum allowed size|exceeds the maximum/i.test(err.message);
}

function isEmpty(data: AppData): boolean {
  return (
    data.foods.length === 0 &&
    data.profiles.length === 0 &&
    data.deletedDayLogEntries.length === 0 &&
    data.deletedFoods.length === 0 &&
    data.deletedProfiles.length === 0
  );
}

function defaultSchedule(fn: () => void, ms: number): () => void {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
}

/**
 * Orders two pending stamps (`<ms base 36>.<sequence base 36>.<tab nonce>`):
 * negative when `a` is older. A stamp that does not parse counts as oldest.
 */
export function compareStamps(a: string, b: string): number {
  const parse = (stamp: string) => {
    const [time, seq, nonce] = stamp.split(".");
    const t = parseInt(time ?? "", 36);
    const s = parseInt(seq ?? "", 36);
    return { t: Number.isFinite(t) ? t : -1, s: Number.isFinite(s) ? s : -1, nonce: nonce ?? "" };
  };
  const x = parse(a);
  const y = parse(b);
  if (x.t !== y.t) return x.t - y.t;
  if (x.s !== y.s) return x.s - y.s;
  return x.nonce < y.nonce ? -1 : x.nonce > y.nonce ? 1 : 0;
}

/**
 * Owns one signed-in account's data on this device: the copy in memory, the
 * one in localStorage, and keeping both in sync with the cloud copy and with
 * the app's other tabs in this browser.
 *
 * - Every change is written locally at once and remembered as pending
 *   (persisted next to the data) until a cloud write carries it, so a reload
 *   or a relaunch does not forget what the cloud lacks.
 * - Every merge, a pull's and a save's, takes the cloud's version of what
 *   both sides have, except this device's pending changes, which win. Nothing
 *   is ever removed except by a tombstone.
 * - A save is a transaction that reads the cloud copy and writes that merge
 *   on top of it, so it never replaces what another device wrote meanwhile,
 *   even when it runs before the sign-in pull or races another write.
 * - Pulls merge into the copy in memory, never into a re-read of
 *   localStorage, and are retried until one succeeds.
 * - Another tab's write to this account's local copy is merged into memory
 *   as soon as the browser reports it.
 */
export class SyncEngine {
  readonly uid: string;
  private readonly keys: LocalKeys;
  private readonly storage: Storage;
  private readonly cloud: CloudPort;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => () => void;
  private readonly log: (message: string, detail?: unknown) => void;

  private snapshot: SyncSnapshot;
  private readonly listeners = new Set<() => void>();

  /** This tab's pending changes: change key → stamp of its latest edit. */
  private readonly pending: Map<ChangeKey, string>;
  /** What the write on its way carries: change → the stamp of its version. */
  private inFlight = new Map<ChangeKey, string>();
  /** Changes this tab writes itself before letting go (see settlePending). */
  private readonly rewrite = new Set<ChangeKey>();
  /** Pending entries a cloud write carried, to drop from the stored list. */
  private readonly carried = new Map<ChangeKey, string>();
  private pulledThisSession = false;
  private lastPullFailed = false;

  private pullInFlight: Promise<void> | null = null;
  private pullQueued = false;
  private saveInFlight = false;
  private saveQueued = false;
  private lastSaveFailed = false;
  /**
   * The last save was refused because the document would pass Firestore's
   * 1 MiB: trying again cannot succeed until the data shrinks, so only a new
   * edit (which might be a deletion) tries again; no timer, return or
   * online event does. Each try costs a read of the whole document.
   */
  private sizeBlocked = false;
  /** Bumped by every cloud write of ours, so a pull can tell it raced one. */
  private cloudGeneration = 0;

  private running = false;
  private readonly safetyStore: SafetyStore | null;
  private safety: SafetyCopy | null = null;
  private safetyPersisted = false;
  private safetyChain: Promise<void> = Promise.resolve();
  private cancelRetry: (() => void) | null = null;
  private retryDelay = RETRY_FIRST_MS;
  private stampSeq = 0;
  /** The last write of this tab's copy to localStorage failed: it is older than memory. */
  private localStale = false;
  /** The last write of the pending marks failed: some of this tab's edits are not marked. */
  private marksStale = false;
  private readonly stampNonce: string;

  constructor(options: SyncEngineOptions) {
    this.uid = options.uid;
    this.storage = options.storage ?? localStorage;
    this.cloud = options.cloud;
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? defaultSchedule;
    this.log = options.log ?? (() => {});
    this.stampNonce = options.stampNonce ?? Math.random().toString(36).slice(2, 8);

    this.keys = localKeysFor(this.uid, this.storage);
    const data = loadAppData(this.keys, this.storage);
    // A mark counts only when the stored copy holds the version it was made
    // for. One that does not (the copy's write did not fit, or a tab wrote
    // an older version over it) would make an older version win over the
    // cloud's: the cloud's version wins instead.
    this.pending = new Map();
    for (const [change, mark] of Object.entries(loadSyncMeta(this.keys, this.storage).pending)) {
      if (mark.print === changeFingerprint(change, data)) this.pending.set(change, mark.stamp);
    }
    this.snapshot = {
      data,
      undoStack: [],
      redoStack: [],
      storageError: null,
      cloudError: null,
      saveStatus: { kind: "idle" },
      cloudBytes: null,
      safetyCopy: null,
    };
    this.safetyStore = options.safety ?? null;
    // Every change to the safety copy goes through this chain, so a loss
    // found before the stored copy was read is added to it, not written over it.
    this.safetyChain = this.loadSafety();
  }

  // --- what the UI reads -------------------------------------------------

  getSnapshot = (): SyncSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** How many changes this device holds that the cloud copy lacks. */
  get pendingCount(): number {
    return this.pending.size;
  }

  private update(patch: Partial<SyncSnapshot>): void {
    const dataChanged = patch.data != null && patch.data !== this.snapshot.data;
    this.snapshot = { ...this.snapshot, ...patch };
    if (dataChanged && this.safety != null) this.refreshSafety();
    for (const listener of [...this.listeners]) listener();
  }

  // --- lifecycle and the events that trigger a sync -----------------------

  /** Starts syncing: the sign-in pull, then any pending save. Safe to call again. */
  start(): void {
    if (this.running) return;
    this.running = true;
    if (!this.pulledThisSession) this.pull();
    else if (this.pending.size > 0) this.requestSave();
  }

  /** Stops the retry timer. Work already on its way still completes. */
  stop(): void {
    this.running = false;
    this.cancelRetry?.();
    this.cancelRetry = null;
  }

  /** The window regained focus or became visible. */
  notifyReturn(): void {
    if (!this.running) return;
    // The copy or the marks did not fit last time; space may have been freed since.
    // Both together: while the marks did not fit, other tabs may have
    // written over this tab's versions in the stored copy.
    if (this.localStale || this.marksStale) this.writeLocal(this.snapshot.data);
    this.pull();
    if (this.lastSaveFailed && !this.sizeBlocked && this.pending.size > 0) this.requestSave();
  }

  /** The browser says it is back online. */
  notifyOnline(): void {
    this.notifyReturn();
  }

  /** Whether this tab made the edit `stamp` names (rather than handed it over). */
  private isOwn(stamp: string): boolean {
    return stamp.endsWith(`.${this.stampNonce}`);
  }

  /**
   * Another tab of this browser wrote `key` (the window's `storage` event).
   *
   * When it is this account's local copy, its changes are merged into this
   * tab's. For a change either tab has not saved yet, the newer edit wins,
   * and between equal stamps the tab that made the edit; for the rest this
   * tab keeps its own version until its next pull. This tab takes the
   * other's unsaved changes on as its own, so they still reach the cloud if
   * the other tab closes first. If the stored copy lacks one of this tab's
   * winning changes, this tab writes the merge back, so a relaunch finds
   * both; the other tab then defers to it, so the two never keep rewriting.
   *
   * When it is the pending list, a change another tab handed over and has
   * since saved (it left the list) stops being pending here too.
   */
  handleStorageEvent(key: string | null, newValue: string | null): void {
    if (key == null || key === this.keys.data || key === this.keys.sync) {
      if (key == null || newValue == null) {
        // Something else on this origin removed this account's copy (or
        // cleared the whole origin) while this tab still holds all of it:
        // write it straight back, so a relaunch does not start from nothing.
        this.log("the local copy was removed, writing it back");
        this.writeLocal(this.snapshot.data);
        return;
      }
    }
    if (newValue == null) return;
    if (key === this.keys.sync) {
      // Another tab edited, or saved and let go of what it saved. A pull of
      // this tab on its way may have read the cloud before that save: its
      // copy would bring back what the save replaced. Read again.
      this.cloudGeneration += 1;
      const stored = loadSyncMeta(this.keys, this.storage).pending;
      for (const [change, stamp] of [...this.pending]) {
        if (!this.mustWrite(change, stamp) && stored[change] == null) this.pending.delete(change);
      }
      // The marks can also arrive after the copy they describe (they did not
      // fit at first): take them on against the stored copy.
      let raw: string | null = null;
      try {
        raw = this.storage.getItem(this.keys.data);
      } catch {
        return;
      }
      if (raw != null) this.mergeStoredCopy(raw);
      return;
    }
    if (key !== this.keys.data) return;
    this.mergeStoredCopy(newValue);
  }

  /** Merges a copy another tab wrote (see handleStorageEvent). */
  private mergeStoredCopy(raw: string): void {
    const other = parseAppData(raw);
    if (other == null) return;
    const memory = this.snapshot.data;
    const marks = loadSyncMeta(this.keys, this.storage).pending;
    const theirs = new Map<ChangeKey, string>();
    const ours: ChangeKey[] = [];
    for (const [change, mark] of Object.entries(marks)) {
      // A version no newer than one this tab already sent to the cloud: a
      // mark whose removal did not fit (full quota). Taking it would bring
      // the older version back.
      const sent = this.carried.get(change);
      if (sent != null && compareStamps(mark.stamp, sent) <= 0) continue;
      const held = this.pending.get(change);
      const order = held == null ? -1 : compareStamps(held, mark.stamp);
      if (order > 0 || (order === 0 && held != null && this.isOwn(held))) ours.push(change);
      // The written copy holds the version the mark names: take it. A copy
      // written by a tab that had not seen that edit yet does not; this tab
      // keeps its own version, and the edit's own write brings it.
      else if (changeFingerprint(change, other) === mark.print) theirs.set(change, mark.stamp);
      // A newer edit than the one this tab holds exists, in a tab whose copy
      // did not fit: that tab writes it. Sending the older one would
      // overwrite it.
      else if (held != null) {
        this.pending.delete(change);
        this.rewrite.delete(change);
      }
    }
    for (const [change, stamp] of [...this.pending]) {
      if (change in marks) continue;
      // Not in the list: an edit of this tab whose list write failed, or one
      // handed over that another tab has saved since.
      if (this.mustWrite(change, stamp)) ours.push(change);
      else this.pending.delete(change);
    }
    let merged = mergeAppData(other, memory, { fillMissingFromLocal: false });
    merged = overlay(merged, other, theirs.keys());
    merged = overlay(merged, memory, ours);
    for (const [change, stamp] of theirs) this.pending.set(change, stamp);
    if (!sameData(merged, memory)) {
      this.log("another tab changed the data, merging it in");
      // Undo frames are snapshots from before the merge: undoing to one
      // would drop what the other tab did.
      this.update({ data: merged, undoStack: [], redoStack: [] });
    }
    // The stored copy must hold every pending version, or a relaunch drops
    // its mark (see the constructor). It is the copy in the event, unless a
    // tab (this one, before the event arrived) wrote over it since.
    let stored: AppData | null = other;
    try {
      const now = this.storage.getItem(this.keys.data);
      if (now !== raw) stored = now == null ? null : parseAppData(now);
    } catch {
      return;
    }
    const lacking = (change: ChangeKey) =>
      stored == null || changeFingerprint(change, stored) !== changeFingerprint(change, merged);
    if ([...this.pending.keys()].some(lacking)) this.writeLocal(merged);
  }

  // --- user changes --------------------------------------------------------

  /**
   * Applies a user change and records it as an undoable action. `base` is
   * the snapshot `next` was computed from; if the data moved on since (a
   * pull landed in between), only what the change touched is replayed.
   */
  commit(next: AppData, base: AppData, label: string): void {
    const current = this.snapshot.data;
    const result = base === current ? next : rebase(current, base, next);
    this.record(label, current, result);
    this.persist(result, current);
  }

  undo(): void {
    const stack = this.snapshot.undoStack;
    if (stack.length === 0) return;
    const frame = stack[stack.length - 1];
    const current = this.snapshot.data;
    const restored = reconcileTombstonesForRestore(frame.before, current, this.isoNow());
    this.update({
      undoStack: stack.slice(0, -1),
      redoStack: [...this.snapshot.redoStack, frame].slice(-MAX_HISTORY),
    });
    this.persist(restored, current);
  }

  redo(): void {
    const stack = this.snapshot.redoStack;
    if (stack.length === 0) return;
    const frame = stack[stack.length - 1];
    const current = this.snapshot.data;
    const restored = reconcileTombstonesForRestore(frame.after, current, this.isoNow());
    this.update({
      redoStack: stack.slice(0, -1),
      undoStack: [...this.snapshot.undoStack, frame].slice(-MAX_HISTORY),
    });
    this.persist(restored, current);
  }

  /**
   * Undoes every action from the top of the stack down to and including the
   * frame at `index` in a single step. The undone frames are pushed onto the
   * redo stack newest-first so a subsequent redo replays them oldest-first,
   * one action at a time.
   */
  undoTo(index: number): void {
    const stack = this.snapshot.undoStack;
    if (index < 0 || index >= stack.length) return;
    const target = stack[index];
    const current = this.snapshot.data;
    const restored = reconcileTombstonesForRestore(target.before, current, this.isoNow());
    const undone = stack.slice(index);
    this.update({
      undoStack: stack.slice(0, index),
      redoStack: [...this.snapshot.redoStack, ...undone.slice().reverse()].slice(-MAX_HISTORY),
    });
    this.persist(restored, current);
  }

  /**
   * Replaces everything with `target` (a backup), as one undoable action.
   * It first pulls, so that what the backup and this device agree on also
   * overrides newer versions from other devices; it throws when that pull
   * fails. What `target` lacks is deleted everywhere (tombstones), and what
   * it holds is restored everywhere, deleted or not.
   */
  async restore(target: AppData, label: string): Promise<void> {
    await this.pullAndWait();
    if (this.lastPullFailed) throw new Error("The cloud copy could not be read.");
    const current = this.snapshot.data;
    const restored = reconcileTombstonesForRestore(target, current, this.isoNow());
    this.record(label, current, restored);
    this.persist(restored, current);
  }

  setStorageError(message: string | null): void {
    this.update({ storageError: message });
  }

  // --- persistence ---------------------------------------------------------

  private isoNow(): string {
    return new Date(this.now()).toISOString();
  }

  private record(label: string, before: AppData, after: AppData): void {
    const frame: HistoryFrame = { label, at: this.isoNow(), before, after };
    this.update({
      undoStack: [...this.snapshot.undoStack, frame].slice(-MAX_HISTORY),
      redoStack: [],
    });
  }

  private persist(next: AppData, prev: AppData): void {
    const changes = changedKeys(prev, next);
    if (changes.size > 0) {
      const stamp = `${this.now().toString(36)}.${(this.stampSeq++).toString(36)}.${this.stampNonce}`;
      for (const change of changes) this.pending.set(change, stamp);
    }
    this.update({ data: next });
    this.writeLocal(next);
    // A change to tombstones alone (deleting something only they track)
    // still has to reach the cloud; tombstones merge, so it needs no key.
    if (changes.size > 0 || !sameTombstoneLists(prev, next)) {
      this.sizeBlocked = false;
      this.requestSave();
    }
  }

  /**
   * Stores `data` as this account's local copy, the pending marks for it
   * first. A copy is only written once its marks are: storage then never
   * holds an unmarked version, which other tabs would take for an older one
   * (and write their own over, back and forth) and a relaunch would let the
   * cloud overwrite. When the marks do not fit, the copy waits in memory
   * (the edits still go to the cloud) until space frees up.
   */
  private writeLocal(data: AppData): void {
    const failure = this.writeMeta(data) ?? this.writeCopy(data);
    if (failure == null) {
      this.localStale = false;
      this.marksStale = false;
      if (this.snapshot.storageError != null) this.update({ storageError: null });
      return;
    }
    this.localStale = true;
    this.log("local save failed", failure);
    this.update({
      storageError: failure instanceof StorageQuotaError ? failure.message : STORAGE_BLOCKED,
    });
  }

  private writeCopy(data: AppData): unknown {
    try {
      saveAppData(this.keys, data, this.storage);
      return null;
    } catch (e) {
      return e;
    }
  }

  /**
   * Stores the pending marks; returns the error when they did not fit. Every
   * tab of this account shares them, so they are read, merged and written:
   * another tab's marks stay, the newer stamp wins a change both have, and
   * what a cloud write of this tab carried leaves.
   *
   * `copy` is the copy about to be stored: this tab's marks name its
   * versions. Without it, they name memory's, and only while the stored copy
   * holds memory (not after a failed write: an older stored copy must not
   * win at the next launch).
   */
  private writeMeta(copy: AppData | null = null): unknown {
    const result: Record<string, PendingMark> = {};
    const stored = loadSyncMeta(this.keys, this.storage).pending;
    for (const [change, mark] of Object.entries(stored)) {
      // A write carried this change in a version at least as new as the one
      // the list names. Going by the exact stamp kept an older mark whose
      // update had not fit (full quota): the next launch then let the stale
      // local copy win over the newer version this very write had sent.
      const carried = this.carried.get(change);
      if (carried != null && compareStamps(mark.stamp, carried) <= 0) continue;
      result[change] = mark;
    }
    const removalsOnly = { ...result };
    // A change another tab handed over and the list no longer names was
    // saved by some tab since: adding it back would resurrect a mark for a
    // version the cloud already holds, which then beats newer ones.
    for (const [change, stamp] of [...this.pending]) {
      if (!this.mustWrite(change, stamp) && stored[change] == null) this.pending.delete(change);
    }
    const marking = copy != null || !this.localStale;
    if (marking) {
      const data = copy ?? this.snapshot.data;
      for (const [change, stamp] of this.pending) {
        const mark = result[change];
        if (mark == null || compareStamps(mark.stamp, stamp) <= 0) {
          result[change] = { stamp, print: changeFingerprint(change, data) };
        }
      }
    }
    try {
      saveSyncMeta(this.keys, { pending: result }, this.storage);
      this.carried.clear();
      if (marking) this.marksStale = false;
      return null;
    } catch (e) {
      this.marksStale = true;
      this.log("sync state save failed", e);
      // Letting go of what a write carried only shrinks the list, so it fits
      // even when nothing else does; the other tabs must learn of it, or they
      // would send the older versions those marks name again.
      try {
        saveSyncMeta(this.keys, { pending: removalsOnly }, this.storage);
        this.carried.clear();
      } catch {
        // Storage blocked altogether.
      }
      return e;
    }
  }

  /**
   * Whether this tab must write `change` itself before letting it go: its own
   * edit, or one whose older version a write of this tab carried (see
   * settlePending). Any other change another tab handed over leaves when the
   * stored list no longer names it.
   */
  private mustWrite(change: ChangeKey, stamp: string): boolean {
    if (this.isOwn(stamp) || this.rewrite.has(change)) return true;
    // A write of this tab on its way carries an older version of it.
    const sending = this.inFlight.get(change);
    return sending != null && sending !== stamp;
  }

  /**
   * Lets go of the pending changes in `done` that were not edited again
   * since. Returns whether a change `done` carried in an older version is
   * still pending: a write of this tab put that older version in the cloud,
   * possibly after the newer one's tab found nothing to write and let it go,
   * so this tab writes the newer version itself.
   */
  private settlePending(done: ReadonlyMap<ChangeKey, string>): boolean {
    if (done.size === 0) return false;
    let newer = false;
    for (const [change, stamp] of done) {
      const current = this.pending.get(change);
      if (current === stamp) {
        this.pending.delete(change);
        this.rewrite.delete(change);
      } else if (current != null) {
        this.rewrite.add(change);
        newer = true;
      }
      this.carried.set(change, stamp);
    }
    this.writeMeta();
    return newer;
  }

  // --- cloud ---------------------------------------------------------------

  private requestSave(): void {
    if (this.saveInFlight) {
      this.saveQueued = true;
      return;
    }
    void this.save();
  }

  private async save(): Promise<void> {
    this.saveInFlight = true;
    this.saveQueued = false;
    let carried = new Map<ChangeKey, string>();
    let bytes: number | null = null;
    this.update({ saveStatus: { kind: "saving" } });
    this.log("save started");
    try {
      // Built from this tab's state at the moment the transaction has read
      // the cloud copy, and again on every retry: what another tab handed
      // over or changed meanwhile is never written in an older version.
      const result = await this.cloud.write(this.uid, (cloud) => {
        carried = new Map(this.pending);
        this.inFlight = carried;
        let written = mergeForSave(this.snapshot.data, cloud, { pending: new Set(carried.keys()) });
        // Letting go of a change another tab handed over takes a real write
        // even when the cloud already holds it: Firestore then refuses any
        // transaction that read before this one, such as that tab's last
        // write still on its way with an older version.
        if (written == null && cloud != null && [...carried.values()].some((stamp) => !this.isOwn(stamp))) {
          written = cloud;
        }
        const holds = written ?? cloud;
        bytes = holds == null ? null : cloudDocBytes(this.uid, holds);
        if (written != null && bytes != null && bytes > CLOUD_DOC_LIMIT_BYTES) {
          throw new CloudDocTooLargeError(bytes);
        }
        return written;
      });
      if (result.written != null) this.cloudGeneration += 1;
      // Only what this write carried: a change edited again meanwhile has a
      // newer stamp and stays pending for the next write.
      if (this.settlePending(carried)) this.saveQueued = true;
      this.lastSaveFailed = false;
      this.sizeBlocked = false;
      this.onSuccess();
      const done = this.pending.size === 0 && !this.saveQueued;
      this.update({
        cloudError: null,
        cloudBytes: bytes ?? this.snapshot.cloudBytes,
        saveStatus: done ? { kind: "saved", at: this.now() } : { kind: "saving" },
      });
      this.log("save succeeded");
    } catch (err) {
      this.lastSaveFailed = true;
      this.log("save failed", err);
      const full = isTooLarge(err);
      this.sizeBlocked = full;
      this.update({
        cloudError: full ? CLOUD_DOC_FULL : CLOUD_SYNC_FAILED,
        cloudBytes: full && err instanceof CloudDocTooLargeError ? err.bytes : this.snapshot.cloudBytes,
        saveStatus: { kind: "idle" },
      });
      if (!full) this.scheduleRetry();
    } finally {
      this.saveInFlight = false;
      this.inFlight = new Map();
      if (this.saveQueued) void this.save();
    }
  }

  /**
   * Pulls the cloud copy and merges it into this device's data, then pushes
   * the merge back if this device had something the cloud lacked. Runs at
   * sign-in and again whenever the app comes back into view: the installed
   * Dock app stays open for days, and without the re-pull it never sees what
   * was logged in a browser tab.
   */
  private pull(): void {
    if (this.pullInFlight != null) return;
    this.pullInFlight = this.runPull();
  }

  /** Runs a pull (or joins the one on its way) and waits for it to finish. */
  private async pullAndWait(): Promise<void> {
    if (this.pullInFlight != null) {
      // The pull on its way may have read the cloud before the caller's
      // moment; queue one more after it.
      this.pullQueued = true;
      await this.pullInFlight;
      while (this.pullInFlight != null) await this.pullInFlight;
      return;
    }
    this.pull();
    while (this.pullInFlight != null) await this.pullInFlight;
  }

  private async runPull(): Promise<void> {
    this.pullQueued = false;
    const generation = this.cloudGeneration;
    const reason = this.pulledThisSession ? "refocus" : "initial";
    this.log(`${reason} load started`);
    try {
      const cloud = await this.cloud.load(this.uid);
      if (generation !== this.cloudGeneration) {
        // A write of ours landed while this read was out, and cleared the
        // pending changes it carried: this read may predate it. Read again.
        this.pullQueued = true;
        return;
      }
      this.lastPullFailed = false;
      const local = this.snapshot.data;
      if (cloud == null) {
        // A first sign-in: nothing in the cloud yet.
        this.pulledThisSession = true;
        this.update({ cloudBytes: null });
        if (!isEmpty(local) || this.pending.size > 0) {
          this.requestSave();
        } else {
          this.update({ cloudError: null });
          this.onSuccess();
        }
        return;
      }
      const { merged, localChanged, cloudChanged } = mergeForPull(local, cloud, {
        pending: new Set(this.pending.keys()),
      });
      // A change the cloud already holds as this device has it no longer
      // needs to win: its write landed even if this device never heard back.
      // When the merge adds nothing to the cloud copy, none does. Not while
      // a write of ours is on its way, though: this read may predate it, and
      // the write may still land an older version of the same change.
      // Only this tab's own changes, though: one another tab handed over may
      // still be on its way from that tab in an older version (a write sent
      // just before it closed), which would land after this read. Those are
      // let go by a write of this tab, which such a late write cannot pass.
      const settled = new Map<ChangeKey, string>();
      let handedOverHeld = false;
      if (!this.saveInFlight) {
        for (const [change, stamp] of this.pending) {
          if (!cloudChanged || changeHolds(change, local, cloud)) {
            if (this.isOwn(stamp)) settled.set(change, stamp);
            else handedOverHeld = true;
          }
        }
      }
      if (localChanged) {
        this.log("cloud data differs, merging with local");
        this.adopt(merged);
      }
      this.pulledThisSession = true;
      this.update({ cloudBytes: cloudDocBytes(this.uid, cloud) });
      this.settlePending(settled);
      if (cloudChanged || handedOverHeld) {
        if (!this.sizeBlocked) this.requestSave();
      } else {
        this.lastSaveFailed = false;
        this.update({ cloudError: null });
        this.onSuccess();
      }
    } catch (err) {
      this.lastPullFailed = true;
      this.log(`${reason} load failed`, err);
      this.update({ cloudError: CLOUD_SYNC_FAILED });
      this.scheduleRetry();
    } finally {
      this.pullInFlight = null;
      if (this.pullQueued) this.pull();
    }
  }

  /** Takes a merge as this device's data. */
  private adopt(merged: AppData): void {
    const before = this.snapshot.data;
    this.keepSafetyCopy(before, merged);
    // Undo frames captured before the merge are pre-merge snapshots; undoing
    // to one would drop what the merge brought in. Drop the session history.
    this.update({ data: merged, undoStack: [], redoStack: [] });
    this.writeLocal(merged);
  }

  // --- safety copy ---------------------------------------------------------

  private async loadSafety(): Promise<void> {
    if (this.safetyStore == null) return;
    try {
      const stored = await this.safetyStore.load(this.uid);
      if (stored == null) return;
      // A copy kept in this session already holds what it lost; add to it.
      this.safety =
        this.safety == null
          ? stored
          : { savedAt: this.safety.savedAt, data: restoreMissing(this.safety.data, stored.data, this.isoNow()) };
      this.safetyPersisted = true;
      this.refreshSafety();
    } catch (e) {
      this.log("safety copy load failed", e);
    }
  }

  /** A pull is about to turn `before` into `after`: keep what it takes away. */
  private keepSafetyCopy(before: AppData, after: AppData): void {
    if (detectDataLoss(before, after) == null) return;
    this.safetyChain = this.safetyChain.then(async () => {
      const copy = safetyCopyAfterMerge(this.safety, before, after, this.isoNow());
      if (copy == null) return;
      this.safety = copy;
      this.safetyPersisted = false;
      this.refreshSafety();
      this.log("a pull removed data from this device; kept a safety copy");
      if (this.safetyStore == null) return;
      try {
        this.safetyPersisted = await this.safetyStore.save(this.uid, copy);
      } catch (e) {
        this.log("safety copy save failed", e);
      }
      if (this.safety === copy) this.refreshSafety();
    });
  }

  /** Recomputes what the copy holds that this device lacks; lets it go when nothing. */
  private refreshSafety(): void {
    const copy = this.safety;
    if (copy == null) return;
    const loss = detectDataLoss(copy.data, this.snapshot.data);
    if (loss == null) {
      // Everything it held is back (restored, or synced back from elsewhere).
      this.dismissSafetyCopy();
      return;
    }
    this.snapshot = {
      ...this.snapshot,
      safetyCopy: { savedAt: copy.savedAt, loss, persisted: this.safetyPersisted },
    };
    for (const listener of [...this.listeners]) listener();
  }

  /** Brings back everything the safety copy holds and this device lacks, as one undoable action. */
  restoreSafetyCopy(): void {
    const copy = this.safety;
    if (copy == null) return;
    const current = this.snapshot.data;
    const restored = restoreMissing(current, copy.data, this.isoNow());
    this.record("Restore what sync removed", current, restored);
    this.persist(restored, current);
  }

  /** Forgets the safety copy, here and in its store. */
  dismissSafetyCopy(): void {
    if (this.safety == null && this.snapshot.safetyCopy == null) return;
    this.safety = null;
    this.snapshot = { ...this.snapshot, safetyCopy: null };
    for (const listener of [...this.listeners]) listener();
    const store = this.safetyStore;
    if (store == null) return;
    this.safetyChain = this.safetyChain.then(async () => {
      if (this.safety != null) return; // a new loss arrived meanwhile
      try {
        await store.clear(this.uid);
      } catch (e) {
        this.log("safety copy clear failed", e);
      }
    });
  }

  private onSuccess(): void {
    this.retryDelay = RETRY_FIRST_MS;
    if (this.pulledThisSession && this.pending.size === 0) {
      this.cancelRetry?.();
      this.cancelRetry = null;
    }
  }

  private scheduleRetry(): void {
    if (!this.running || this.cancelRetry != null) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
    this.cancelRetry = this.schedule(() => {
      this.cancelRetry = null;
      if (!this.running) return;
      if (!this.pulledThisSession || this.lastPullFailed) this.pull();
      if (this.pending.size > 0 && !this.saveInFlight && !this.sizeBlocked) this.requestSave();
    }, delay);
  }
}
