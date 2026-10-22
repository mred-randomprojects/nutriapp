/**
 * Random histories on the real SyncEngine, for syncEngine.random.test.ts.
 */
import type {
  AppData,
  DayLog,
  DayLogItem,
  FoodId,
  LogEntryId,
  Profile,
  ProfileId,
} from "./types.js";
import { FakeServer, FakeStorage, openDevice, settle, type Device } from "./syncTestKit.js";
import type { HistoryFrame } from "./syncEngine.js";
import { deepEqual, sameData } from "./syncMerge.js";

// Random histories on the real SyncEngine: several browsers, each with one or
// more tabs, editing the same account while they go offline, relaunch, close
// mid-save and race each other. Every record has one owner (the tab slot that
// writes it), so "the owner's latest value" is well defined: at the end, once
// everything is back online, the cloud and every open tab must hold exactly
// that for every record, whatever happened in between.

const UID = "uid-max";
const P1 = "p1" as ProfileId;
const DATES = ["2026-10-13", "2026-10-14", "2026-10-15"];
const PROFILE_FIELDS = ["goals", "schedule", "weightLossPlan", "mealPlans", "name"] as const;
const DELETED = Symbol("deleted");

type Value = unknown;
type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: Rng, items: ReadonlyArray<T>): T => items[Math.floor(rng() * items.length)];

// --- mutations, built the way useAppData builds them ------------------------

function mapP1(d: AppData, change: (p: Profile) => Profile): AppData {
  return { ...d, profiles: d.profiles.map((p) => (p.id === P1 ? change(p) : p)) };
}

function mapDay(p: Profile, date: string, change: (day: DayLog) => DayLog): Profile {
  const existing = p.dayLogs.find((dl) => dl.date === date);
  if (existing == null) return { ...p, dayLogs: [...p.dayLogs, change({ date, entries: [] })] };
  return { ...p, dayLogs: p.dayLogs.map((dl) => (dl.date === date ? change(dl) : dl)) };
}

function addEntry(d: AppData, date: string, id: string, grams: number, at: number | null): AppData {
  const item: DayLogItem = { id: id as LogEntryId, foodId: "builtin" as FoodId, grams };
  return mapP1(d, (p) =>
    mapDay(p, date, (day) => ({
      ...day,
      entries:
        at == null
          ? [...day.entries, item]
          : [...day.entries.slice(0, at), item, ...day.entries.slice(at)],
    })),
  );
}

function editEntry(d: AppData, date: string, id: string, grams: number): AppData {
  return mapP1(d, (p) => ({
    ...p,
    dayLogs: p.dayLogs.map((dl) =>
      dl.date === date
        ? { ...dl, entries: dl.entries.map((e) => (e.id === id && e.type == null ? { ...e, grams } : e)) }
        : dl,
    ),
  }));
}

function deleteEntry(d: AppData, date: string, id: string, at: string): AppData {
  return {
    ...mapP1(d, (p) => ({
      ...p,
      dayLogs: p.dayLogs.map((dl) =>
        dl.date === date ? { ...dl, entries: dl.entries.filter((e) => e.id !== id) } : dl,
      ),
    })),
    deletedDayLogEntries: [
      ...d.deletedDayLogEntries.filter((t) => !(t.date === date && t.entryId === id)),
      { profileId: P1, date, entryId: id as LogEntryId, deletedAt: at },
    ],
  };
}

function addFood(d: AppData, id: string, name: string): AppData {
  return {
    ...d,
    foods: [
      ...d.foods,
      {
        id: id as FoodId,
        name,
        imageUrl: null,
        nutritionPer100g: { calories: 100, protein: 1, saturatedFat: 1, fiber: 1 },
        nutritionPerUnit: null,
        gramsPerUnit: null,
        ingredients: null,
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ],
  };
}

function editFood(d: AppData, id: string, name: string): AppData {
  return { ...d, foods: d.foods.map((f) => (f.id === id ? { ...f, name } : f)) };
}

function deleteFood(d: AppData, id: string, at: string): AppData {
  return {
    ...d,
    foods: d.foods.filter((f) => f.id !== id),
    deletedFoods: [
      ...d.deletedFoods.filter((t) => t.foodId !== id),
      { foodId: id as FoodId, deletedAt: at },
    ],
  };
}

function setWeight(d: AppData, date: string, weightKg: number | undefined): AppData {
  return mapP1(d, (p) => mapDay(p, date, (day) => ({ ...day, weightKg })));
}

function setProfileField(d: AppData, field: string, value: Value): AppData {
  return mapP1(d, (p) => ({ ...p, [field]: value }));
}

// --- reading records back ----------------------------------------------------

function p1(d: AppData | null): Profile | undefined {
  return d?.profiles.find((p) => p.id === P1);
}

function readRecord(d: AppData | null, key: string): Value | typeof DELETED {
  const [kind, a, b] = JSON.parse(key) as string[];
  const profile = p1(d);
  switch (kind) {
    case "entry": {
      const entry = profile?.dayLogs.find((dl) => dl.date === a)?.entries.find((e) => e.id === b);
      return entry == null ? DELETED : entry.type == null ? entry.grams : DELETED;
    }
    case "food": {
      const food = d?.foods.find((f) => f.id === a);
      return food == null ? DELETED : food.name;
    }
    case "weight":
      return profile?.dayLogs.find((dl) => dl.date === a)?.weightKg;
    case "field":
      return profile == null ? DELETED : (profile as unknown as Record<string, unknown>)[a];
    case "plan": {
      const plan = profile?.mealPlans?.find((m) => m.id === a);
      return plan == null ? DELETED : plan.name;
    }
    default:
      throw new Error(`unknown record ${key}`);
  }
}

// --- the model: what each owner last set ------------------------------------

interface Change {
  key: string;
  before: Value | typeof DELETED;
  after: Value | typeof DELETED;
}

interface ModelFrame {
  changes: Change[];
  frame: HistoryFrame;
}

interface Slot {
  name: string;
  browser: number;
  tab: Device | null;
  /** Owned records → the owner's latest value. */
  records: Map<string, Value | typeof DELETED>;
  /** The slot's own undoable actions, each tied to the engine's frame for it. */
  undo: ModelFrame[];
  redo: ModelFrame[];
  seq: number;
  /** The weight date and the profile field this slot owns. */
  weightDate: string;
  field: string;
}

interface Browser {
  storage: FakeStorage;
  online: boolean;
  /**
   * The shared origin quota is full: every localStorage write that does not
   * shrink its key fails. Only while online, and no tab of it dies meanwhile:
   * an edit that fits neither this device nor the cloud is gone with the
   * page, and no model can say what its owner last set.
   */
  full: boolean;
}



export interface SimOptions {
  seed: number;
  browsers: number;
  tabsPerBrowser: number;
  steps: number;
  /** Periods when the origin's localStorage quota is full (default on). */
  fullQuota?: boolean;
  /** Debugging: every step, engine log line and change of `watch` in the cloud. */
  debug?: (line: string) => void;
  watch?: string;
}

function fieldValue(field: string, n: number, slot: string): Value {
  switch (field) {
    case "goals":
      return { calories: 1800 + n, protein: 120, saturatedFat: 10, saturatedFatMode: "grams", fiber: 30 };
    case "schedule":
      return { wakeHour: n % 12, sleepHour: 22 };
    case "weightLossPlan":
      return n % 3 === 0
        ? null
        : { startDate: "2026-10-01", startWeightKg: 90, targetWeightKg: 80 - (n % 5), weeklyLossRateKg: 0.5 };
    case "mealPlans":
      return [
        {
          id: `${slot}-plan-${n}`,
          name: `Plan ${slot} ${n}`,
          entries: [],
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
        },
      ];
    default:
      return `Max ${slot} ${n}`;
  }
}

export async function simulate(options: SimOptions): Promise<string[]> {
  const rng = mulberry32(options.seed);
  const server = new FakeServer();
  let clock = Date.UTC(2026, 9, 16, 12);
  const now = () => (clock += 1 + Math.floor(rng() * 50));
  const iso = () => new Date(now()).toISOString();

  const browsers: Browser[] = Array.from({ length: options.browsers }, () => ({
    storage: new FakeStorage(),
    online: true,
    full: false,
  }));
  const setFull = (browserIndex: number, full: boolean) => {
    const browser = browsers[browserIndex];
    browser.full = full;
    // Full: what is stored now is all that fits; a write that grows it fails.
    browser.storage.quota = full ? browser.storage.used() : Infinity;
    trace.push(`browser ${browserIndex} storage ${full ? "full" : "freed"}`);
    // Coming back to the app is when it finds the space again.
    if (!full) for (const s of slots) if (s.browser === browserIndex) s.tab?.engine.notifyReturn();
  };
  const slots: Slot[] = [];
  for (let b = 0; b < options.browsers; b++) {
    for (let t = 0; t < options.tabsPerBrowser; t++) {
      const index = slots.length;
      slots.push({
        name: `b${b}t${t}`,
        browser: b,
        tab: null,
        records: new Map(),
        undo: [],
        redo: [],
        seq: 0,
        weightDate: `2026-09-${String(10 + index).padStart(2, "0")}`,
        field: PROFILE_FIELDS[index % PROFILE_FIELDS.length],
      });
    }
  }
  // A field owned by two slots would have no single "latest" value.
  const fieldOwners = new Map<string, Slot>();
  for (const slot of slots) {
    if (fieldOwners.has(slot.field)) slot.field = "";
    else fieldOwners.set(slot.field, slot);
  }

  const open = (slot: Slot) => {
    const browser = browsers[slot.browser];
    slot.tab = openDevice(slot.name, {
      server,
      uid: UID,
      storage: browser.storage,
      online: browser.online,
      latency: {
        load: 1 + Math.floor(rng() * 6),
        read: 1 + Math.floor(rng() * 3),
        commit: 1 + Math.floor(rng() * 6),
      },
      now,
      stampNonce: Math.floor(rng() * 36 ** 6).toString(36).padStart(6, "0"),
      log:
        options.debug == null
          ? undefined
          : (message, detail) => options.debug?.(`  ${slot.name}: ${message}${detail != null ? ` (${String(detail)})` : ""}`),
    });
    slot.undo = [];
    slot.redo = [];
  };

  // Seed: slot 0 creates the profile, and everyone starts from it.
  open(slots[0]);
  const seedTab = slots[0].tab!;
  seedTab.engine.commit(
    {
      ...seedTab.data,
      profiles: [
        {
          id: P1,
          name: "Max",
          dayLogs: [],
          createdAt: "2026-10-01T00:00:00.000Z",
          goals: null,
          schedule: null,
          userMetrics: null,
          weightLossPlan: null,
          mealPlans: [],
          weeklyPlan: {},
        },
      ],
      activeProfileId: P1,
    },
    seedTab.data,
    "Add profile",
  );
  await settle();
  for (const slot of slots) {
    if (slot.tab == null) open(slot);
    // Meal plans merge plan by plan: each is a record of its own (below).
    if (slot.field !== "" && slot.field !== "mealPlans") {
      slot.records.set(JSON.stringify(["field", slot.field]), readRecord(server.doc(UID), JSON.stringify(["field", slot.field])));
    }
  }
  await settle();

  const trace: string[] = [];
  if (options.debug != null) {
    const put = server.put.bind(server);
    server.put = (uid, data, writer) => {
      put(uid, data, writer);
      if (options.watch != null) options.debug?.(`  cloud (${writer}) ${options.watch} = ${String(readRecord(data, options.watch) === DELETED ? "deleted" : JSON.stringify(readRecord(data, options.watch)))}`);
    };
    const push = trace.push.bind(trace);
    trace.push = (...lines: string[]) => {
      for (const line of lines) options.debug?.(line);
      return push(...lines);
    };
  }

  /** Applies one of the slot's own changes and records it in the model. */
  function apply(slot: Slot, label: string, build: (d: AppData) => AppData, keys: string[]) {
    const tab = slot.tab!;
    const base = tab.data;
    const before = keys.map((key) => slot.records.get(key) ?? DELETED);
    tab.engine.commit(build(base), base, label);
    const changes: Change[] = keys.map((key, i) => {
      const after = readRecord(tab.data, key);
      // Setting what this tab already shows changes nothing, even when that
      // view is stale (an older local copy while the cloud moved on): the
      // owner's latest value stays what it was.
      if (!deepEqual(readRecord(base, key), after)) slot.records.set(key, after);
      return { key, before: before[i], after };
    });
    const frames = tab.engine.getSnapshot().undoStack;
    syncHistory(slot);
    slot.undo.push({ changes, frame: frames[frames.length - 1] });
    slot.redo = [];
    trace.push(`${slot.name} ${label}`);
  }

  /**
   * The engine drops its history when it adopts a merge (a pull, another
   * tab's write) and trims it to 50; the model keeps only the frames the
   * engine still has.
   */
  function syncHistory(slot: Slot) {
    const snapshot = slot.tab!.engine.getSnapshot();
    slot.undo = slot.undo.filter((m) => snapshot.undoStack.includes(m.frame));
    slot.redo = slot.redo.filter((m) => snapshot.redoStack.includes(m.frame));
  }

  function ownEntries(slot: Slot): Array<{ date: string; id: string }> {
    const result: Array<{ date: string; id: string }> = [];
    for (const [key, value] of slot.records) {
      const [kind, date, id] = JSON.parse(key) as string[];
      if (kind === "entry" && value !== DELETED) result.push({ date, id });
    }
    return result;
  }

  function ownFoods(slot: Slot): string[] {
    const result: string[] = [];
    for (const [key, value] of slot.records) {
      const [kind, id] = JSON.parse(key) as string[];
      if (kind === "food" && value !== DELETED) result.push(id);
    }
    return result;
  }

  for (let step = 0; step < options.steps; step++) {
    const roll = rng();
    const slot = pick(rng, slots);
    const browser = browsers[slot.browser];

    if (roll < 0.3) {
      await settle(Math.floor(rng() * 6));
      continue;
    }
    if (roll < 0.33) {
      if (options.fullQuota === false) continue;
      if (browser.full) setFull(slot.browser, false);
      else if (browser.online) setFull(slot.browser, true);
      continue;
    }
    if (roll < 0.36) {
      if (browser.full) continue;
      browser.online = !browser.online;
      for (const s of slots) {
        if (s.browser === slot.browser && s.tab != null) s.tab.cloud.online = browser.online;
      }
      trace.push(`browser ${slot.browser} ${browser.online ? "online" : "offline"}`);
      if (browser.online) {
        for (const s of slots) if (s.browser === slot.browser) s.tab?.engine.notifyOnline();
      }
      continue;
    }
    if (roll < 0.4) {
      if (slot.tab == null) {
        open(slot);
        trace.push(`${slot.name} opens`);
      } else if (!browser.full) {
        // The page dies: whatever was on its way may or may not have landed.
        slot.tab.kill(rng() < 0.5);
        slot.tab = null;
        trace.push(`${slot.name} closes`);
        // Whatever the dead page had on the wire lands now or never.
        await settle(2);
      }
      continue;
    }
    if (slot.tab == null) continue;
    if (roll < 0.46) {
      slot.tab.engine.notifyReturn();
      trace.push(`${slot.name} refocus`);
      continue;
    }
    if (roll < 0.48) {
      slot.tab.timers.fireAll();
      continue;
    }

    // A person switching tabs is far slower than the browser telling one
    // tab about another's write: let the pending storage events arrive.
    await settle(1);
    if (slot.tab == null) continue;
    const op = rng();
    const tab = slot.tab;
    syncHistory(slot);
    if (op < 0.06 && slot.undo.length > 0) {
      const top = slot.undo.pop()!;
      const frames = tab.engine.getSnapshot().undoStack;
      if (frames[frames.length - 1] !== top.frame) throw new Error("model and engine undo stacks diverged");
      tab.engine.undo();
      for (const change of top.changes) slot.records.set(change.key, readRecord(tab.data, change.key));
      slot.redo.push(top);
      trace.push(`${slot.name} undo`);
      continue;
    }
    if (op < 0.09 && slot.redo.length > 0) {
      const top = slot.redo.pop()!;
      const frames = tab.engine.getSnapshot().redoStack;
      if (frames[frames.length - 1] !== top.frame) throw new Error("model and engine redo stacks diverged");
      tab.engine.redo();
      for (const change of top.changes) slot.records.set(change.key, readRecord(tab.data, change.key));
      slot.undo.push(top);
      trace.push(`${slot.name} redo`);
      continue;
    }
    const n = ++slot.seq;
    const entries = ownEntries(slot).filter(({ date, id }) =>
      p1(tab.data)?.dayLogs.find((dl) => dl.date === date)?.entries.some((e) => e.id === id),
    );
    if (op < 0.4 || entries.length === 0) {
      const date = pick(rng, DATES);
      const id = `${slot.name}-e${n}`;
      const day = p1(tab.data)?.dayLogs.find((dl) => dl.date === date);
      const at = rng() < 0.5 || day == null ? null : Math.floor(rng() * (day.entries.length + 1));
      apply(slot, `add ${id} on ${date}`, (d) => addEntry(d, date, id, 10 + n, at), [
        JSON.stringify(["entry", date, id]),
      ]);
    } else if (op < 0.55) {
      const { date, id } = pick(rng, entries);
      apply(slot, `edit ${id}`, (d) => editEntry(d, date, id, 500 + n), [JSON.stringify(["entry", date, id])]);
    } else if (op < 0.65) {
      const { date, id } = pick(rng, entries);
      const at = iso();
      apply(slot, `delete ${id}`, (d) => deleteEntry(d, date, id, at), [JSON.stringify(["entry", date, id])]);
    } else if (op < 0.73) {
      const id = `${slot.name}-f${n}`;
      apply(slot, `add food ${id}`, (d) => addFood(d, id, `food ${n}`), [JSON.stringify(["food", id])]);
    } else if (op < 0.8) {
      const foods = ownFoods(slot).filter((id) => tab.data.foods.some((f) => f.id === id));
      if (foods.length === 0) continue;
      const id = pick(rng, foods);
      if (rng() < 0.6) {
        apply(slot, `rename food ${id}`, (d) => editFood(d, id, `food ${n}`), [JSON.stringify(["food", id])]);
      } else {
        const at = iso();
        apply(slot, `delete food ${id}`, (d) => deleteFood(d, id, at), [JSON.stringify(["food", id])]);
      }
    } else if (op < 0.9) {
      const weight = rng() < 0.2 ? undefined : 70 + n;
      apply(slot, `weight ${slot.weightDate} ${weight}`, (d) => setWeight(d, slot.weightDate, weight), [
        JSON.stringify(["weight", slot.weightDate]),
      ]);
    } else if (slot.field === "mealPlans") {
      // Replaces the plans this tab shows with a new one: removes each plan
      // it sees and adds one, plan by plan, as the app's own edits do.
      const value = fieldValue(slot.field, n, slot.name) as Array<{ id: string }>;
      const seen = (p1(tab.data)?.mealPlans ?? []).map((m) => m.id);
      apply(
        slot,
        `set ${slot.field}`,
        (d) => setProfileField(d, slot.field, value),
        [...new Set([...seen, ...value.map((m) => m.id)])].map((id) => JSON.stringify(["plan", id])),
      );
    } else if (slot.field !== "") {
      const value = fieldValue(slot.field, n, slot.name);
      apply(slot, `set ${slot.field}`, (d) => setProfileField(d, slot.field, value), [
        JSON.stringify(["field", slot.field]),
      ]);
    }
  }

  // Everything back online, every browser with a tab open, a few rounds of
  // returns and retries.
  for (let b = 0; b < browsers.length; b++) if (browsers[b].full) setFull(b, false);
  for (const browser of browsers) browser.online = true;
  for (const slot of slots) {
    if (slot.tab != null) {
      slot.tab.cloud.online = true;
      slot.tab.engine.notifyOnline();
    }
  }
  for (let b = 0; b < browsers.length; b++) {
    if (!slots.some((s) => s.browser === b && s.tab != null)) open(slots.find((s) => s.browser === b)!);
  }
  for (let round = 0; round < 6; round++) {
    await settle(40);
    for (const slot of slots) {
      slot.tab?.timers.fireAll();
      slot.tab?.engine.notifyReturn();
    }
  }
  await settle(80);

  const problems: string[] = [];
  // Quiet: with nothing new to say, no tab writes to the cloud or to storage.
  const activity = () =>
    `${server.log.filter((l) => l.endsWith(":committed")).length}/${browsers.map((b) => b.storage.writes).join(",")}`;
  const before = activity();
  for (const slot of slots) slot.tab?.engine.notifyReturn();
  await settle(80);
  if (activity() !== before) problems.push(`still writing when there is nothing new: ${before} -> ${activity()}`);
  const cloud = server.doc(UID);
  for (const slot of slots) {
    for (const [key, expected] of slot.records) {
      const actual = readRecord(cloud, key);
      if (!deepEqual(actual, expected)) {
        problems.push(`cloud ${key}: expected ${String(expected === DELETED ? "deleted" : JSON.stringify(expected))}, got ${String(actual === DELETED ? "deleted" : JSON.stringify(actual))}`);
      }
    }
  }
  for (const slot of slots) {
    if (slot.tab == null) continue;
    if (cloud == null || !sameData(slot.tab.data, cloud)) {
      problems.push(`${slot.name} differs from the cloud copy at ${firstDifference(slot.tab.data, cloud)}`);
    }
    const snapshot = slot.tab.engine.getSnapshot();
    if (snapshot.cloudError != null) problems.push(`${slot.name} still shows ${snapshot.cloudError}`);
    if (slot.tab.engine.pendingCount !== 0) problems.push(`${slot.name} still has ${slot.tab.engine.pendingCount} pending`);
  }
  for (const day of p1(cloud)?.dayLogs ?? []) {
    const ids = day.entries.map((e) => e.id);
    if (new Set(ids).size !== ids.length) problems.push(`duplicate entries on ${day.date}`);
  }
  for (const slot of slots) slot.tab?.close();
  if (problems.length > 0) problems.push(`trace: ${trace.slice(-(Number(process.env.SIM_TRACE ?? 60))).join(" | ")}`);
  return problems;
}

/** Where two values first differ, as a path, for the failure message. */
function firstDifference(a: unknown, b: unknown, path = "$"): string | null {
  if (deepEqual(a, b)) return null;
  if (a == null || b == null || typeof a !== "object" || typeof b !== "object") {
    return `${path}: ${JSON.stringify(a)?.slice(0, 120)} vs ${JSON.stringify(b)?.slice(0, 120)}`;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const ids = (xs: unknown[]) => xs.map((x) => (x as { id?: string; date?: string })?.id ?? (x as { date?: string })?.date ?? "?");
    if (a.length !== b.length) return `${path}: length ${a.length} vs ${b.length} [${ids(a).join(",")}] vs [${ids(b).join(",")}]`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (d != null) return d;
    }
    return `${path}: ?`;
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  for (const key of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    const d = firstDifference(ra[key], rb[key], `${path}.${key}`);
    if (d != null) return d;
  }
  return `${path}: ?`;
}

