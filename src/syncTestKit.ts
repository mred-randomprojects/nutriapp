/**
 * Test doubles for syncEngine.test.ts: a localStorage with a quota and the
 * cross-tab `storage` event, and a Firestore stand-in whose reads and
 * transactions are separate round trips with their own latency, that retries
 * a transaction when the document changed under it (as the Web SDK does),
 * can be offline per device, and rejects documents over a size cap.
 */
import type { AppData } from "./types.js";
import type { CloudPort, CloudWrite } from "./syncEngine.js";
import { SyncEngine } from "./syncEngine.js";
import { mergeAppData } from "./mergeAppData.js";
import {
  filterDeletedAppEntitiesFromAppData,
  mergeDeletedFoods,
  mergeDeletedProfiles,
} from "./deletedAppEntities.js";
import { mergeDeletedDayLogEntries } from "./deletedDayLogEntries.js";

export class FakeStorage implements Storage {
  private readonly map = new Map<string, string>();
  /** Writes so far, to tell when the tabs have gone quiet. */
  writes = 0;
  /** Total characters (keys + values) it accepts. */
  quota = Infinity;
  /**
   * Refuses a write the way a full origin does: return true to throw
   * QuotaExceededError for it (e.g. every write that does not shrink).
   */
  refuse: ((key: string, value: string, previous: string | null) => boolean) | null = null;
  /** Tabs sharing this storage, told about each other's writes. */
  readonly tabs = new Set<{ onStorage(key: string, newValue: string | null): void }>();

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.refuse?.(key, value, this.map.get(key) ?? null)) {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    }
    let used = 0;
    for (const [k, v] of this.map) if (k !== key) used += k.length + v.length;
    if (used + key.length + value.length > this.quota) {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    }
    this.map.set(key, value);
    this.writes += 1;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  used(): number {
    let used = 0;
    for (const [k, v] of this.map) used += k.length + v.length;
    return used;
  }
}

/**
 * Wraps a FakeStorage for one tab: its writes reach the other tabs as
 * `storage` events, asynchronously, the way browsers deliver them.
 */
export class TabStorage implements Storage {
  /** Set when the page dies: a dead page writes nothing. */
  dead = false;

  constructor(
    private readonly shared: FakeStorage,
    private readonly self: { onStorage(key: string, newValue: string | null): void },
  ) {}

  get length(): number {
    return this.shared.length;
  }

  key(index: number): string | null {
    return this.shared.key(index);
  }

  getItem(key: string): string | null {
    return this.shared.getItem(key);
  }

  setItem(key: string, value: string): void {
    if (this.dead) return;
    const before = this.shared.getItem(key);
    this.shared.setItem(key, value);
    if (before !== value) this.broadcast(key, value);
  }

  removeItem(key: string): void {
    if (this.dead) return;
    const before = this.shared.getItem(key);
    this.shared.removeItem(key);
    if (before != null) this.broadcast(key, null);
  }

  clear(): void {
    throw new Error("NutriApp must never clear the shared origin's storage");
  }

  private broadcast(key: string, newValue: string | null): void {
    for (const tab of this.shared.tabs) {
      if (tab === this.self) continue;
      setImmediate(() => tab.onStorage(key, newValue));
    }
  }
}

function clone<T>(value: T): T {
  return value == null ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export class FakeFirestoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FirebaseError";
  }
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

export class FakeServer {
  readonly docs = new Map<string, { data: AppData; version: number }>();
  readonly log: string[] = [];
  /** Characters of JSON a document may hold (stands in for the 1 MiB limit). */
  maxDocChars = Infinity;

  doc(uid: string): AppData | null {
    return clone(this.docs.get(uid)?.data ?? null);
  }

  /** Who wrote each version, oldest first (the simulation's debug output reads it). */
  readonly writers: string[] = [];

  put(uid: string, data: AppData, writer = "?"): void {
    const previous = this.docs.get(uid);
    this.docs.set(uid, { data: clone(data), version: (previous?.version ?? 0) + 1 });
    this.writers.push(writer);
  }
}

export interface Latency {
  load: number;
  read: number;
  commit: number;
}

/**
 * One device's connection to the FakeServer. A read is served when it is
 * sent and its answer arrives `latency` ticks later, so it can be older than
 * a write that commits in between: the worst case a real round trip allows.
 */
export class FakeCloud implements CloudPort {
  online = true;
  /**
   * The page died: no answer reaches it any more. A commit already on its way
   * lands ("apply") or not ("drop").
   */
  killed: "apply" | "drop" | null = null;
  latency: Latency = { load: 2, read: 1, commit: 1 };

  constructor(
    private readonly server: FakeServer,
    readonly name: string,
  ) {}

  private async trip(kind: string, ticks: number): Promise<void> {
    for (let i = 0; i < ticks; i++) {
      // A commit already on the wire when the page died reaches the server
      // within its last hop, long before a relaunch could read anything;
      // only then is "it landed or it did not" a fact the next launch sees.
      if (kind === "commit" && this.killed === "apply") break;
      await tick();
    }
    if (this.killed != null && !(kind === "commit" && this.killed === "apply")) {
      throw new FakeFirestoreError("cancelled", `${kind}: the page is gone.`);
    }
    if (!this.online) {
      throw new FakeFirestoreError("unavailable", `Failed ${kind}: the client is offline.`);
    }
    this.server.log.push(`${this.name}:${kind}`);
  }

  async load(uid: string): Promise<AppData | null> {
    const served = this.server.doc(uid);
    await this.trip("load", this.latency.load);
    return served;
  }

  async write(uid: string, build: (cloud: AppData | null) => AppData | null): Promise<CloudWrite> {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const version = this.server.docs.get(uid)?.version ?? 0;
      const cloud = this.server.doc(uid);
      await this.trip("read", this.latency.read);
      const written = build(clone(cloud));
      await this.trip("commit", this.latency.commit);
      if ((this.server.docs.get(uid)?.version ?? 0) !== version) {
        this.server.log.push(`${this.name}:retry#${attempt}`);
        continue;
      }
      if (written != null) {
        const chars = JSON.stringify(written).length;
        if (chars > this.server.maxDocChars) {
          throw new FakeFirestoreError(
            "invalid-argument",
            `Document exceeds the maximum allowed size (${chars} > ${this.server.maxDocChars}).`,
          );
        }
        this.server.put(uid, written, this.name);
        this.server.log.push(`${this.name}:committed`);
      }
      return { cloud, written: clone(written) };
    }
    throw new FakeFirestoreError("aborted", "Transaction failed after 5 attempts.");
  }
}

/** Retry timers the test fires by hand. */
export class ManualTimers {
  private readonly timers = new Set<{ fn: () => void; ms: number }>();

  schedule = (fn: () => void, ms: number): (() => void) => {
    const timer = { fn, ms };
    this.timers.add(timer);
    return () => {
      this.timers.delete(timer);
    };
  };

  get count(): number {
    return this.timers.size;
  }

  fireAll(): void {
    const due = [...this.timers];
    this.timers.clear();
    for (const timer of due) timer.fn();
  }
}

export interface Device {
  name: string;
  engine: SyncEngine;
  cloud: FakeCloud;
  storage: FakeStorage;
  timers: ManualTimers;
  readonly data: AppData;
  close(): void;
  /** The page dies mid-flight; a commit on its way lands when `landsInFlight`. */
  kill(landsInFlight: boolean): void;
}

export interface DeviceOptions {
  server: FakeServer;
  uid: string;
  /** Tabs of one browser share it; give each device its own. */
  storage?: FakeStorage;
  online?: boolean;
  latency?: Partial<Latency>;
  now?: () => number;
  log?: (message: string, detail?: unknown) => void;
  /** This tab's stamp nonce; random when left out. */
  stampNonce?: string;
}

/** A device (or a tab, when it shares `storage`) with the app open and syncing. */
export function openDevice(name: string, options: DeviceOptions): Device {
  const storage = options.storage ?? new FakeStorage();
  const cloud = new FakeCloud(options.server, name);
  cloud.online = options.online ?? true;
  cloud.latency = { ...cloud.latency, ...options.latency };
  const timers = new ManualTimers();
  // The browser tells each tab about the others' writes, as useAppData wires it.
  const tab = {
    onStorage: (key: string, newValue: string | null) => engine.handleStorageEvent(key, newValue),
  };
  storage.tabs.add(tab);
  const tabStorage = new TabStorage(storage, tab);
  const engine: SyncEngine = new SyncEngine({
    uid: options.uid,
    cloud,
    storage: tabStorage,
    schedule: timers.schedule,
    now: options.now,
    log: options.log,
    stampNonce: options.stampNonce,
  });
  engine.start();
  return {
    name,
    engine,
    cloud,
    storage,
    timers,
    get data() {
      return engine.getSnapshot().data;
    },
    close() {
      engine.stop();
      storage.tabs.delete(tab);
    },
    kill(landsInFlight: boolean) {
      engine.stop();
      storage.tabs.delete(tab);
      tabStorage.dead = true;
      cloud.killed = landsInFlight ? "apply" : "drop";
    },
  };
}

/** Lets every queued round trip, retry and storage event run to completion. */
export async function settle(turns = 60): Promise<void> {
  for (let i = 0; i < turns; i++) await tick();
}

/**
 * A tab still running the build before the sync engine (HEAD 4adfae0), as far
 * as the cloud copy is concerned: its pull merges with the cloud winning
 * every id both have, and every edit replaces the whole document with its
 * own copy, keeping only the cloud's tombstones (the old saveCloudData).
 */
export class LegacyTab {
  constructor(
    private readonly server: FakeServer,
    private readonly uid: string,
    public data: AppData,
  ) {}

  pull(): void {
    const cloud = this.server.doc(this.uid);
    if (cloud != null) this.data = mergeAppData(this.data, cloud);
  }

  edit(change: (data: AppData) => AppData): void {
    this.data = change(this.data);
    const cloud = this.server.doc(this.uid);
    this.server.put(
      this.uid,
      filterDeletedAppEntitiesFromAppData({
        ...this.data,
        deletedDayLogEntries: mergeDeletedDayLogEntries(
          this.data.deletedDayLogEntries,
          cloud?.deletedDayLogEntries ?? [],
        ),
        deletedFoods: mergeDeletedFoods(this.data.deletedFoods, cloud?.deletedFoods ?? []),
        deletedProfiles: mergeDeletedProfiles(this.data.deletedProfiles, cloud?.deletedProfiles ?? []),
      }),
      "legacy",
    );
  }
}
