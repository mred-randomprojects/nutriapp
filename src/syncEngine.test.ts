import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AppData,
  DayLogItem,
  FoodId,
  LogEntry,
  LogEntryId,
  MealPlanId,
  Profile,
  ProfileId,
  SavedMealPlan,
} from "./types.js";
import {
  FakeServer,
  FakeStorage,
  LegacyTab,
  openDevice,
  settle,
  type Device,
} from "./syncTestKit.js";
import { CLOUD_DOC_FULL, CLOUD_SYNC_FAILED } from "./syncEngine.js";

// Each scenario is a finding from the 2026-10-16 audit, replayed on the real
// SyncEngine (storage, merge, tombstones) against a Firestore stand-in. The
// assertions are the fixed behaviour; on the code before the fix the same
// steps gave the outcome quoted in each test's comment.

const UID = "uid-max";
const DAY = "2026-10-15";
const P1 = "p1" as ProfileId;
const T0 = "2026-10-01T12:00:00.000Z";

// --- mutations, built the way useAppData builds them ------------------------

function edit(device: Device, change: (data: AppData) => AppData, label = "edit"): void {
  const base = device.data;
  device.engine.commit(change(base), base, label);
}

function profile(id: string, name: string): Profile {
  return {
    id: id as ProfileId,
    name,
    dayLogs: [],
    createdAt: T0,
    goals: null,
    schedule: null,
    userMetrics: null,
    weightLossPlan: null,
    mealPlans: [],
    weeklyPlan: {},
  };
}

const addProfile = (id: string, name: string) => (d: AppData): AppData => ({
  ...d,
  profiles: [...d.profiles, profile(id, name)],
  activeProfileId: d.activeProfileId ?? (id as ProfileId),
});

const addFood = (id: string, name: string) => (d: AppData): AppData => ({
  ...d,
  foods: [
    ...d.foods,
    {
      id: id as FoodId,
      name,
      imageUrl: null,
      nutritionPer100g: { calories: 380, protein: 13, saturatedFat: 1, fiber: 10 },
      nutritionPerUnit: null,
      gramsPerUnit: null,
      ingredients: null,
      createdAt: T0,
    },
  ],
});

function mapProfile(d: AppData, id: ProfileId, change: (p: Profile) => Profile): AppData {
  return { ...d, profiles: d.profiles.map((p) => (p.id === id ? change(p) : p)) };
}

function mapEntries(
  p: Profile,
  date: string,
  change: (entries: DayLogItem[]) => DayLogItem[],
): Profile {
  const existing = p.dayLogs.find((dl) => dl.date === date);
  if (existing == null) return { ...p, dayLogs: [...p.dayLogs, { date, entries: change([]) }] };
  return {
    ...p,
    dayLogs: p.dayLogs.map((dl) => (dl.date === date ? { ...dl, entries: change(dl.entries) } : dl)),
  };
}

const food = (id: string, foodId: string, grams: number): LogEntry => ({
  id: id as LogEntryId,
  foodId: foodId as FoodId,
  grams,
});

const quick = (id: string, name: string): DayLogItem => ({
  type: "quick-add",
  id: id as LogEntryId,
  name,
  nutrition: { calories: 100, protein: 1, saturatedFat: 1, fiber: 1 },
});

const separator = (id: string, label: string): DayLogItem => ({
  type: "separator",
  id: id as LogEntryId,
  label,
});

const addEntry = (item: DayLogItem, at?: number, date = DAY) => (d: AppData): AppData =>
  mapProfile(d, P1, (p) =>
    mapEntries(p, date, (entries) =>
      at == null ? [...entries, item] : [...entries.slice(0, at), item, ...entries.slice(at)],
    ),
  );

const setGrams = (entryId: string, grams: number) => (d: AppData): AppData =>
  mapProfile(d, P1, (p) =>
    mapEntries(p, DAY, (entries) =>
      entries.map((e) => (e.id === entryId && e.type == null ? { ...e, grams } : e)),
    ),
  );

const setWeight = (weightKg: number | undefined) => (d: AppData): AppData =>
  mapProfile(d, P1, (p) => ({
    ...p,
    dayLogs: p.dayLogs.map((dl) => (dl.date === DAY ? { ...dl, weightKg } : dl)),
  }));

const savePlan = (id: string, name: string) => (d: AppData): AppData =>
  mapProfile(d, P1, (p) => {
    const plan: SavedMealPlan = {
      id: id as MealPlanId,
      name,
      entries: [],
      createdAt: T0,
      updatedAt: T0,
    };
    return { ...p, mealPlans: [...(p.mealPlans ?? []), plan] };
  });

const deletePlan = (id: string) => (d: AppData): AppData =>
  mapProfile(d, P1, (p) => ({ ...p, mealPlans: (p.mealPlans ?? []).filter((m) => m.id !== id) }));

// --- reading the data back ---------------------------------------------------

function day(d: AppData | null, date = DAY) {
  return d?.profiles.find((p) => p.id === P1)?.dayLogs.find((dl) => dl.date === date);
}

function entryIds(d: AppData | null, date = DAY): string[] {
  return day(d, date)?.entries.map((e) => e.id) ?? [];
}

function grams(d: AppData | null, entryId: string): number | undefined {
  const entry = day(d)?.entries.find((e) => e.id === entryId);
  return entry != null && entry.type == null ? entry.grams : undefined;
}

function planNames(d: AppData | null): string[] {
  return d?.profiles.find((p) => p.id === P1)?.mealPlans?.map((m) => m.name) ?? [];
}

/** One profile, one food, entry e1 (100 g), a weight of 80 and the plan "Cut". */
async function seed(device: Device): Promise<void> {
  edit(device, addProfile(P1, "Max"));
  edit(device, addFood("f1", "Oats"));
  edit(device, addEntry(food("e1", "f1", 100)));
  edit(device, setWeight(80));
  edit(device, savePlan("m-cut", "Cut"));
  await settle();
}

describe("sanity: the harness syncs like the app", () => {
  it("a second device picks up the first device's data on sign-in", async () => {
    const server = new FakeServer();
    const a = openDevice("A", { server, uid: UID });
    await seed(a);
    assert.equal(grams(server.doc(UID), "e1"), 100);
    const b = openDevice("B", { server, uid: UID });
    await settle();
    assert.equal(grams(b.data, "e1"), 100);
    assert.deepEqual(planNames(b.data), ["Cut"]);
    assert.equal(b.engine.getSnapshot().cloudError, null);
    a.close();
    b.close();
  });
});

describe("unsynced edits survive the next launch (unsynced-edits-reverted-on-relaunch)", () => {
  it("keeps edits made offline through a relaunch, and then syncs them", async () => {
    // Before the fix: { grams: 100, weightKg: 80, plans: ["Cut"], cloudError: null }.
    const server = new FakeServer();
    const storage = new FakeStorage();
    const a1 = openDevice("A1", { server, uid: UID, storage });
    await seed(a1);

    a1.cloud.online = false;
    edit(a1, setGrams("e1", 150));
    edit(a1, setWeight(79));
    edit(a1, savePlan("m-bulk", "Bulk"));
    await settle();
    assert.equal(a1.engine.getSnapshot().cloudError, CLOUD_SYNC_FAILED);
    a1.close();

    const a2 = openDevice("A2", { server, uid: UID, storage });
    await settle();
    assert.equal(grams(a2.data, "e1"), 150);
    assert.equal(day(a2.data)?.weightKg, 79);
    assert.deepEqual(planNames(a2.data), ["Cut", "Bulk"]);
    const cloud = server.doc(UID);
    assert.equal(grams(cloud, "e1"), 150);
    assert.equal(day(cloud)?.weightKg, 79);
    assert.deepEqual(planNames(cloud), ["Cut", "Bulk"]);
    assert.equal(a2.engine.pendingCount, 0);
    assert.equal(a2.engine.getSnapshot().cloudError, null);
    a2.close();
  });

  it("keeps an edit whose save was still in flight when the app closed", async () => {
    // Before the fix: back to 100 g.
    const server = new FakeServer();
    const storage = new FakeStorage();
    const a1 = openDevice("A1", { server, uid: UID, storage });
    await seed(a1);
    a1.cloud.latency.commit = 50;
    edit(a1, setGrams("e1", 175));
    a1.cloud.online = false; // the page dies before the write lands
    a1.close();
    await settle(80);

    const a2 = openDevice("A2", { server, uid: UID, storage });
    await settle();
    assert.equal(grams(a2.data, "e1"), 175);
    assert.equal(grams(server.doc(UID), "e1"), 175);
    a2.close();
  });

  it("lets this device win only for what it changed, not for what another device changed", async () => {
    const server = new FakeServer();
    const macStorage = new FakeStorage();
    const mac = openDevice("mac", { server, uid: UID, storage: macStorage });
    await seed(mac);
    edit(mac, addEntry(food("e2", "f1", 50)));
    await settle();
    const phone = openDevice("phone", { server, uid: UID });
    await settle();

    mac.cloud.online = false;
    edit(mac, setGrams("e1", 150)); // offline on the Mac
    await settle();
    edit(phone, setGrams("e2", 60)); // meanwhile on the phone
    await settle();
    mac.close();

    const mac2 = openDevice("mac2", { server, uid: UID, storage: macStorage });
    await settle();
    assert.equal(grams(mac2.data, "e1"), 150, "the Mac's offline edit");
    assert.equal(grams(mac2.data, "e2"), 60, "the phone's edit, not reverted by the Mac");
    assert.equal(grams(server.doc(UID), "e2"), 60);
    phone.engine.notifyReturn();
    await settle();
    assert.equal(grams(phone.data, "e1"), 150);
    mac2.close();
    phone.close();
  });
});

describe("writes before or alongside the sign-in merge (nutriapp-failed-initial-pull-overwrites-cloud, writes-before-signin-merge)", () => {
  async function staleMac() {
    // The Dock app synced, then sat closed while the phone corrected the
    // grams, saved a plan and added a food.
    const server = new FakeServer();
    const macStorage = new FakeStorage();
    const mac = openDevice("mac", { server, uid: UID, storage: macStorage });
    await seed(mac);
    mac.close();
    const phone = openDevice("phone", { server, uid: UID });
    await settle();
    edit(phone, setGrams("e1", 120));
    edit(phone, savePlan("m-phone", "Phone plan"));
    edit(phone, addFood("f-phone", "Phone food"));
    await settle();
    return { server, macStorage, phone };
  }

  it("(a) a failed sign-in pull does not let the first edit replace the cloud copy", async () => {
    // Before the fix: cloud 100 g and ["Cut"], and the phone reverted to them too.
    const { server, macStorage, phone } = await staleMac();
    const mac = openDevice("mac", { server, uid: UID, storage: macStorage, online: false });
    await settle();
    assert.equal(mac.engine.getSnapshot().cloudError, CLOUD_SYNC_FAILED);
    mac.cloud.online = true;
    edit(mac, addEntry(quick("coffee", "coffee")));
    await settle();

    const cloud = server.doc(UID);
    assert.equal(grams(cloud, "e1"), 120);
    assert.deepEqual(planNames(cloud), ["Cut", "Phone plan"]);
    assert.ok(cloud?.foods.some((f) => f.name === "Phone food"));
    assert.ok(entryIds(cloud).includes("coffee"));
    phone.engine.notifyReturn();
    await settle();
    assert.equal(grams(phone.data, "e1"), 120);
    assert.deepEqual(planNames(phone.data), ["Cut", "Phone plan"]);
    assert.ok(entryIds(phone.data).includes("coffee"));
    mac.close();
    phone.close();
  });

  it("(a) retries the failed sign-in pull until it lands, and then shows the phone's changes", async () => {
    const { server, macStorage, phone } = await staleMac();
    const mac = openDevice("mac", { server, uid: UID, storage: macStorage, online: false });
    await settle();
    assert.equal(grams(mac.data, "e1"), 100);
    assert.equal(mac.timers.count, 1, "a retry is scheduled");
    mac.cloud.online = true;
    mac.timers.fireAll();
    await settle();
    assert.equal(grams(mac.data, "e1"), 120);
    assert.deepEqual(planNames(mac.data), ["Cut", "Phone plan"]);
    assert.equal(mac.engine.getSnapshot().cloudError, null);
    mac.close();
    phone.close();
  });

  it("(a) the online event retries the sign-in pull too", async () => {
    const { server, macStorage, phone } = await staleMac();
    const mac = openDevice("mac", { server, uid: UID, storage: macStorage, online: false });
    await settle();
    mac.cloud.online = true;
    mac.engine.notifyOnline();
    await settle();
    assert.equal(grams(mac.data, "e1"), 120);
    mac.close();
    phone.close();
  });

  it("(b) an edit made before the sign-in read comes back does not overwrite the cloud copy", async () => {
    // Before the fix: cloud 100 g and ["Cut"].
    const { server, macStorage, phone } = await staleMac();
    const mac = openDevice("mac", {
      server,
      uid: UID,
      storage: macStorage,
      latency: { load: 30, read: 1, commit: 1 },
    });
    edit(mac, addEntry(quick("coffee", "coffee")));
    await settle(90);

    const cloud = server.doc(UID);
    assert.equal(grams(cloud, "e1"), 120);
    assert.deepEqual(planNames(cloud), ["Cut", "Phone plan"]);
    assert.ok(entryIds(cloud).includes("coffee"));
    assert.equal(grams(mac.data, "e1"), 120);
    assert.ok(entryIds(mac.data).includes("coffee"));
    mac.close();
    phone.close();
  });

  it("(c) the push after a pull cannot undo a newer edit when its transaction retries", async () => {
    // Before the fix: the cloud ended at 100 g while the app showed 133, and
    // the next pull reverted the app too.
    const server = new FakeServer();
    const storage = new FakeStorage();
    const a = openDevice("A", { server, uid: UID, storage });
    await seed(a);
    const other = openDevice("other", { server, uid: UID });
    await settle();
    edit(other, addFood("f-other", "other's food"));
    await settle();
    other.close();
    a.cloud.online = false;
    edit(a, addFood("f-offline", "offline food"));
    await settle();
    a.close();

    const a2 = openDevice("A2", {
      server,
      uid: UID,
      storage,
      latency: { load: 1, read: 1, commit: 20 },
    });
    await settle(8); // the sign-in pull merged; its push waits on a slow commit
    a2.cloud.latency.commit = 1;
    edit(a2, setGrams("e1", 133));
    await settle(120);
    assert.equal(grams(server.doc(UID), "e1"), 133);
    a2.engine.notifyReturn();
    await settle();
    assert.equal(grams(a2.data, "e1"), 133);
    const names = server.doc(UID)?.foods.map((f) => f.name);
    assert.ok(names?.includes("other's food") && names.includes("offline food"));
    a2.close();
  });

  it("an emptied local copy with a live session never wipes the cloud copy", async () => {
    // Site data cleared but the Firebase session survived: before the fix the
    // first new profile replaced every cloud profile and food.
    const server = new FakeServer();
    const a = openDevice("A", { server, uid: UID });
    await seed(a);
    a.close();
    const wiped = openDevice("wiped", {
      server,
      uid: UID,
      latency: { load: 30, read: 1, commit: 1 },
    });
    edit(wiped, addProfile("p2", "New"));
    await settle(90);
    const cloud = server.doc(UID);
    assert.deepEqual(cloud?.profiles.map((p) => p.name).sort(), ["Max", "New"]);
    assert.equal(grams(cloud, "e1"), 100);
    assert.deepEqual(cloud?.foods.map((f) => f.name), ["Oats"]);
    wiped.close();
  });
});

describe("pulls merge into what the app shows (nutriapp-two-tabs-stale-overwrite, first half)", () => {
  it("a tab's return pull adopts what another tab wrote, and its next edit keeps it", async () => {
    // Before the fix: tab 2 never saw X, and its edit wrote [food, Y] over
    // localStorage and the cloud: X was gone for good.
    const server = new FakeServer();
    const storage = new FakeStorage();
    const tab1 = openDevice("tab1", { server, uid: UID, storage });
    await seed(tab1);
    const tab2 = openDevice("tab2", { server, uid: UID, storage });
    await settle();

    edit(tab1, addEntry(quick("x", "X")));
    await settle();
    tab2.engine.notifyReturn();
    await settle();
    assert.ok(entryIds(tab2.data).includes("x"));
    edit(tab2, addEntry(quick("y", "Y")));
    await settle();
    assert.deepEqual(entryIds(server.doc(UID)), ["e1", "x", "y"]);
    tab1.close();
    tab2.close();
    const tab3 = openDevice("tab3", { server, uid: UID, storage });
    await settle();
    assert.deepEqual(entryIds(tab3.data), ["e1", "x", "y"]);
    tab3.close();
  });

  it("an edit computed before a pull landed is replayed on top of it", async () => {
    const server = new FakeServer();
    const a = openDevice("A", { server, uid: UID });
    await seed(a);
    const b = openDevice("B", { server, uid: UID });
    await settle();
    edit(b, addEntry(quick("from-b", "B")));
    await settle();

    const stale = a.data; // what the screen was built from
    a.engine.notifyReturn();
    await settle();
    assert.ok(entryIds(a.data).includes("from-b"));
    a.engine.commit(setGrams("e1", 90)(stale), stale, "Edit entry");
    await settle();
    assert.equal(grams(a.data, "e1"), 90);
    assert.ok(entryIds(a.data).includes("from-b"), "the pulled entry is not dropped");
    assert.ok(entryIds(server.doc(UID)).includes("from-b"));
    a.close();
    b.close();
  });

  it("a pull that read the cloud before this device's own write landed does not revert it", async () => {
    const server = new FakeServer();
    const a = openDevice("A", { server, uid: UID, latency: { load: 6, read: 1, commit: 1 } });
    await seed(a);
    a.engine.notifyReturn(); // the read goes out now...
    edit(a, setGrams("e1", 140)); // ...and this write lands before it returns
    await settle();
    assert.equal(grams(a.data, "e1"), 140);
    assert.equal(grams(server.doc(UID), "e1"), 140);
    a.close();
  });
});

describe("saves merge into the cloud copy instead of replacing it", () => {
  it("keeps an entry logged under Lunch under Lunch, not at the end of the day", async () => {
    const server = new FakeServer();
    const a = openDevice("A", { server, uid: UID });
    await seed(a);
    edit(a, addEntry(separator("lunch", "Lunch"), 0));
    edit(a, addEntry(separator("dinner", "Dinner")));
    await settle();
    const b = openDevice("B", { server, uid: UID });
    await settle();
    edit(b, addEntry(quick("b-dinner", "B's dessert")));
    await settle();
    // A has not seen B's entry; it logs a salad under Lunch.
    edit(a, addEntry(quick("salad", "Salad"), 2));
    await settle();
    assert.deepEqual(entryIds(server.doc(UID)), ["lunch", "e1", "salad", "dinner", "b-dinner"]);
    a.close();
    b.close();
  });

  it("a cleared weight and a deleted meal plan stay cleared and deleted", async () => {
    const server = new FakeServer();
    const a = openDevice("A", { server, uid: UID });
    await seed(a);
    const b = openDevice("B", { server, uid: UID });
    await settle();
    edit(a, setWeight(undefined));
    edit(a, deletePlan("m-cut"));
    await settle();
    const cloud = server.doc(UID);
    assert.equal(day(cloud)?.weightKg, undefined);
    assert.deepEqual(planNames(cloud), []);
    b.engine.notifyReturn();
    await settle();
    assert.deepEqual(planNames(b.data), []);
    a.close();
    b.close();
  });

  it("an edit to one meal plan keeps a plan another device added meanwhile", async () => {
    const server = new FakeServer();
    const mac = openDevice("mac", { server, uid: UID });
    await seed(mac);
    const phone = openDevice("phone", { server, uid: UID });
    await settle();
    edit(phone, savePlan("m-phone", "Phone plan"));
    await settle();
    // The Dock app has not pulled since; it renames its plan.
    edit(mac, (d) =>
      mapProfile(d, P1, (p) => ({
        ...p,
        mealPlans: (p.mealPlans ?? []).map((m) => (m.id === "m-cut" ? { ...m, name: "Cut v2" } : m)),
      })),
    );
    await settle();
    assert.deepEqual(planNames(server.doc(UID)).sort(), ["Cut v2", "Phone plan"]);
    mac.engine.notifyReturn();
    phone.engine.notifyReturn();
    await settle();
    assert.deepEqual(planNames(mac.data).sort(), ["Cut v2", "Phone plan"]);
    assert.deepEqual(planNames(phone.data).sort(), ["Cut v2", "Phone plan"]);
    mac.close();
    phone.close();
  });

  it("a meal plan deleted on one device stays deleted after the other edits another plan", async () => {
    const server = new FakeServer();
    const mac = openDevice("mac", { server, uid: UID });
    await seed(mac);
    edit(mac, savePlan("m-bulk", "Bulk"));
    await settle();
    const phone = openDevice("phone", { server, uid: UID });
    await settle();
    edit(phone, deletePlan("m-bulk"));
    await settle();
    edit(mac, (d) =>
      mapProfile(d, P1, (p) => ({
        ...p,
        mealPlans: (p.mealPlans ?? []).map((m) => (m.id === "m-cut" ? { ...m, name: "Cut v2" } : m)),
      })),
    );
    await settle();
    assert.deepEqual(planNames(server.doc(UID)), ["Cut v2"]);
    mac.close();
    phone.close();
  });

  it("does not write when the cloud copy already holds everything", async () => {
    const server = new FakeServer();
    const a = openDevice("A", { server, uid: UID });
    await seed(a);
    const commits = server.log.filter((l) => l === "A:committed").length;
    a.engine.notifyReturn();
    await settle();
    assert.equal(server.log.filter((l) => l === "A:committed").length, commits);
    a.close();
  });
});

describe("two tabs of one browser keep each other's edits (nutriapp-two-tabs-stale-overwrite)", () => {
  it("each tab takes the other's entries as they are written, with no refocus, and neither edit drops the other's", async () => {
    const server = new FakeServer();
    const storage = new FakeStorage();
    const tab1 = openDevice("tab1", { server, uid: UID, storage });
    await seed(tab1);
    const tab2 = openDevice("tab2", { server, uid: UID, storage });
    await settle();
    tab1.cloud.online = false;
    tab2.cloud.online = false;
    edit(tab1, addEntry(quick("x", "X")));
    await settle();
    assert.ok(entryIds(tab2.data).includes("x"), "tab 2 shows tab 1's entry");
    edit(tab2, addEntry(quick("y", "Y")));
    await settle();
    assert.deepEqual(entryIds(tab1.data), ["e1", "x", "y"]);
    tab1.close();
    tab2.close();
    // Both closed while offline: the next launch still holds both, and sends both.
    const tab3 = openDevice("tab3", { server, uid: UID, storage });
    await settle();
    assert.deepEqual(entryIds(tab3.data), ["e1", "x", "y"]);
    assert.deepEqual(entryIds(server.doc(UID)), ["e1", "x", "y"]);
    tab3.close();
  });

  it("writes its copy back when another app on the origin removes it", async () => {
    const server = new FakeServer();
    const storage = new FakeStorage();
    const tab = openDevice("tab", { server, uid: UID, storage });
    await seed(tab);
    tab.cloud.online = false;
    edit(tab, setGrams("e1", 130)); // only on this device so far
    await settle();
    storage.removeItem("nutriapp-data");
    storage.removeItem("nutriapp-data-backup");
    tab.engine.handleStorageEvent("nutriapp-data", null);
    await settle();
    tab.close();
    const relaunch = openDevice("relaunch", { server, uid: UID, storage });
    await settle();
    assert.equal(grams(relaunch.data, "e1"), 130);
    assert.equal(grams(server.doc(UID), "e1"), 130);
    relaunch.close();
  });
});

describe("a full origin quota (nutriapp-quota-stale-base)", () => {
  /** Full: a write that does not shrink what the key holds is refused. */
  const full = (_key: string, value: string, previous: string | null) =>
    previous == null || value.length >= previous.length;

  it("keeps sending the latest edits, and a relaunch does not revert them", async () => {
    const server = new FakeServer();
    const storage = new FakeStorage();
    const a = openDevice("A", { server, uid: UID, storage });
    await seed(a);
    a.cloud.online = false;
    edit(a, setGrams("e1", 120)); // stored, with its pending mark
    await settle();
    storage.refuse = full;
    a.cloud.online = true;
    edit(a, setGrams("e1", 1500)); // neither the data nor the mark fits now
    edit(a, setWeight(77));
    await settle();
    assert.notEqual(a.engine.getSnapshot().storageError, null, "the space problem is shown");
    assert.equal(grams(a.data, "e1"), 1500);
    assert.equal(grams(server.doc(UID), "e1"), 1500, "the cloud got the latest grams");
    assert.equal(day(server.doc(UID))?.weightKg, 77);
    a.close();

    // The stored copy still says 120: it must not win over the cloud's 1500.
    const relaunch = openDevice("relaunch", { server, uid: UID, storage });
    await settle();
    assert.equal(grams(server.doc(UID), "e1"), 1500);
    assert.equal(grams(relaunch.data, "e1"), 1500);
    relaunch.close();
  });
});

describe("a full origin quota that frees up again", () => {
  it("stores the copy again when the app comes back into view", async () => {
    const server = new FakeServer();
    const storage = new FakeStorage();
    const a = openDevice("A", { server, uid: UID, storage });
    await seed(a);
    storage.refuse = (key) => key === "nutriapp-data" || key === "nutriapp-data-backup";
    a.cloud.online = false;
    edit(a, setGrams("e1", 150));
    await settle();
    storage.refuse = null; // another app freed its space
    a.engine.notifyReturn();
    assert.equal(a.engine.getSnapshot().storageError, null);
    a.close();
    const relaunch = openDevice("A2", { server, uid: UID, storage, online: false });
    await settle();
    assert.equal(grams(relaunch.data, "e1"), 150, "the offline edit made it to this device's copy");
    relaunch.cloud.online = true;
    relaunch.engine.notifyOnline();
    await settle();
    assert.equal(grams(server.doc(UID), "e1"), 150, "and it is still marked to reach the cloud");
    relaunch.close();
  });
});

describe("a full origin quota, closed offline", () => {
  it("an edit the local copy could not take is not marked to win at the next launch", async () => {
    const server = new FakeServer();
    const macStorage = new FakeStorage();
    const mac = openDevice("mac", { server, uid: UID, storage: macStorage });
    await seed(mac);
    const phone = openDevice("phone", { server, uid: UID });
    await settle();
    // Only the copy itself no longer fits; the small pending list still does.
    macStorage.refuse = (key) => key === "nutriapp-data" || key === "nutriapp-data-backup";
    mac.cloud.online = false;
    edit(mac, setGrams("e1", 150)); // lives in memory only
    await settle();
    mac.close();
    edit(phone, setGrams("e1", 200));
    await settle();

    macStorage.refuse = null;
    const relaunch = openDevice("mac2", { server, uid: UID, storage: macStorage });
    await settle();
    // The stored copy says 100; marked as winning, it would replace the phone's 200.
    assert.equal(grams(server.doc(UID), "e1"), 200);
    assert.equal(grams(relaunch.data, "e1"), 200);
    relaunch.close();
    phone.close();
  });
});

describe("a save refused for size (nutriapp-size-refusal-retried)", () => {
  it("is shown and not retried on a timer, on return or online; the next edit tries once more", async () => {
    const server = new FakeServer();
    const a = openDevice("A", { server, uid: UID });
    await seed(a);
    server.maxDocChars = JSON.stringify(server.doc(UID)).length + 10;
    edit(a, addEntry(quick("big", "a long name that does not fit")));
    await settle();
    const snapshot = a.engine.getSnapshot();
    assert.equal(snapshot.cloudError, CLOUD_DOC_FULL);
    assert.equal(a.timers.count, 0, "no retry timer");
    const reads = () => server.log.filter((l) => l === "A:read").length;
    const before = reads();
    a.engine.notifyReturn();
    a.engine.notifyOnline();
    await settle();
    assert.equal(reads(), before, "no save on return or online");
    assert.ok(entryIds(a.data).includes("big"), "the entry stays on this device");
    edit(a, setGrams("e1", 101));
    await settle();
    assert.equal(reads(), before + 1, "a new edit tries once");
    assert.equal(a.timers.count, 0);
    a.close();
  });
});

describe("a tab still on the previous build (whole-document writes)", () => {
  it("re-adds what the old build's write dropped, and keeps what the old build added", async () => {
    const server = new FakeServer();
    const a = openDevice("A", { server, uid: UID });
    await seed(a);
    // The Dock app on the previous build loaded this copy and kept it open.
    const old = new LegacyTab(server, UID, server.doc(UID)!);
    edit(a, addEntry(quick("new-1", "logged on the new build")));
    edit(a, addFood("f-new", "food added on the new build"));
    await settle();
    // The old build logs something without pulling first: its write lacks new-1 and f-new.
    old.edit(addEntry(quick("old-1", "logged on the old build")));
    assert.ok(!entryIds(server.doc(UID)).includes("new-1"));

    a.engine.notifyReturn();
    await settle();
    const cloud = server.doc(UID);
    assert.deepEqual(entryIds(cloud).sort(), ["e1", "new-1", "old-1"]);
    assert.ok(cloud?.foods.some((f) => f.id === "f-new"));
    assert.deepEqual(entryIds(a.data).sort(), ["e1", "new-1", "old-1"]);
    a.close();
  });

  it("an old build's write never brings back what the new build deleted", async () => {
    const server = new FakeServer();
    const a = openDevice("A", { server, uid: UID });
    await seed(a);
    const old = new LegacyTab(server, UID, server.doc(UID)!);
    edit(a, (d) => ({
      ...mapEntriesOf(d, (entries) => entries.filter((e) => e.id !== "e1")),
      deletedDayLogEntries: [
        ...d.deletedDayLogEntries,
        { profileId: P1, date: DAY, entryId: "e1" as LogEntryId, deletedAt: "2026-10-16T10:00:00.000Z" },
      ],
    }));
    await settle();
    old.edit(setWeight(81));
    a.engine.notifyReturn();
    await settle();
    assert.deepEqual(entryIds(server.doc(UID)), []);
    assert.deepEqual(entryIds(a.data), []);
    old.pull();
    assert.deepEqual(entryIds(old.data), []);
    a.close();
  });
});

function mapEntriesOf(d: AppData, change: (entries: DayLogItem[]) => DayLogItem[]): AppData {
  return {
    ...d,
    profiles: d.profiles.map((p) =>
      p.id === P1
        ? { ...p, dayLogs: p.dayLogs.map((dl) => (dl.date === DAY ? { ...dl, entries: change(dl.entries) } : dl)) }
        : p,
    ),
  };
}

describe("a pull that removes data leaves a safety copy (nutriapp-pull-loss-silent)", () => {
  async function phoneDeletes() {
    const server = new FakeServer();
    const macStorage = new FakeStorage();
    const mac = openDevice("mac", { server, uid: UID, storage: macStorage });
    await seed(mac);
    const phone = openDevice("phone", { server, uid: UID });
    await settle();
    edit(phone, (d) => ({
      ...mapEntriesOf(d, (entries) => entries.filter((e) => e.id !== "e1")),
      deletedDayLogEntries: [
        ...d.deletedDayLogEntries,
        { profileId: P1, date: DAY, entryId: "e1" as LogEntryId, deletedAt: "2026-10-16T10:00:00.000Z" },
      ],
    }));
    edit(phone, deletePlan("m-cut"));
    await settle();
    mac.engine.notifyReturn();
    await settle();
    return { server, mac, macStorage, phone };
  }

  it("keeps what this device had, says what went, and restores it everywhere", async () => {
    const { server, mac, phone } = await phoneDeletes();
    assert.deepEqual(entryIds(mac.data), [], "the pull itself is adopted");
    const safety = mac.engine.getSnapshot().safetyCopy;
    assert.ok(safety != null, "a safety copy is kept");
    assert.equal(safety.loss.entries, 1);
    assert.deepEqual(safety.loss.mealPlans, ["Cut"]);

    mac.engine.restoreSafetyCopy();
    await settle();
    assert.deepEqual(entryIds(mac.data), ["e1"]);
    assert.deepEqual(planNames(mac.data), ["Cut"]);
    assert.deepEqual(entryIds(server.doc(UID)), ["e1"]);
    assert.equal(mac.engine.getSnapshot().safetyCopy, null, "nothing is missing any more");
    phone.engine.notifyReturn();
    await settle();
    assert.deepEqual(entryIds(phone.data), ["e1"]);
    assert.deepEqual(planNames(phone.data), ["Cut"]);
    mac.close();
    phone.close();
  });

  it("survives a relaunch until restored or dismissed", async () => {
    const { server, mac, macStorage, phone } = await phoneDeletes();
    mac.close();
    const relaunch = openDevice("mac2", { server, uid: UID, storage: macStorage });
    await settle();
    assert.equal(relaunch.engine.getSnapshot().safetyCopy?.loss.entries, 1);
    relaunch.engine.dismissSafetyCopy();
    await settle();
    assert.equal(relaunch.engine.getSnapshot().safetyCopy, null);
    relaunch.close();
    const again = openDevice("mac3", { server, uid: UID, storage: macStorage });
    await settle();
    assert.equal(again.engine.getSnapshot().safetyCopy, null);
    assert.deepEqual(entryIds(again.data), []);
    again.close();
    phone.close();
  });

  it("keeps no copy when a pull removes nothing", async () => {
    const server = new FakeServer();
    const mac = openDevice("mac", { server, uid: UID });
    await seed(mac);
    const phone = openDevice("phone", { server, uid: UID });
    await settle();
    edit(phone, addEntry(quick("x", "X")));
    edit(phone, setGrams("e1", 140));
    await settle();
    mac.engine.notifyReturn();
    await settle();
    assert.equal(grams(mac.data, "e1"), 140);
    assert.equal(mac.engine.getSnapshot().safetyCopy, null);
    mac.close();
    phone.close();
  });

  it("catches what an old build's whole-document write cleared (a weight, a meal plan)", async () => {
    const server = new FakeServer();
    const mac = openDevice("mac", { server, uid: UID });
    const old = new LegacyTab(server, UID, {
      foods: [],
      profiles: [],
      activeProfileId: null,
      deletedDayLogEntries: [],
      deletedFoods: [],
      deletedProfiles: [],
    });
    await seed(mac);
    old.pull();
    edit(mac, savePlan("m-new", "New plan"));
    edit(mac, setWeight(77));
    await settle();
    // The old build saves its copy, from before the plan and the new weight.
    old.edit((d) => d);
    mac.engine.notifyReturn();
    await settle();
    const safety = mac.engine.getSnapshot().safetyCopy;
    assert.deepEqual(safety?.loss.mealPlans, ["New plan"]);
    mac.engine.restoreSafetyCopy();
    await settle();
    assert.deepEqual(planNames(server.doc(UID)).sort(), ["Cut", "New plan"]);
    mac.close();
  });
});
