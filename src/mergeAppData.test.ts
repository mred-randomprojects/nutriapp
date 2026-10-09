import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeAppData, planCloudPull } from "./mergeAppData.js";
import type {
  AppData,
  DayLog,
  DayLogItem,
  Food,
  FoodId,
  LogEntry,
  LogEntryId,
  MealPlanId,
  Profile,
  ProfileId,
  SavedMealPlan,
  SectionSeparator,
  UserMetrics,
  WeightLossPlan,
} from "./types.js";

// Characterization tests: they pin what the merge does *today*, including the
// behaviours the audit flags as wrong. A test whose name says "pins nutriapp-1"
// or "pins nutriapp-c1" is expected to change when that sync redesign lands;
// update it then, together with the merge, never on its own.

const T0 = "2026-07-01T00:00:00.000Z";
const T1 = "2026-07-02T00:00:00.000Z";
const T2 = "2026-07-03T00:00:00.000Z";
const DAY = "2026-07-10";
const P1 = "p1" as ProfileId;

function food(id: string, name: string): Food {
  return {
    id: id as FoodId,
    name,
    imageUrl: null,
    nutritionPer100g: { calories: 100, protein: 10, saturatedFat: 1, fiber: 1 },
    nutritionPerUnit: null,
    gramsPerUnit: null,
    ingredients: null,
    createdAt: T0,
  };
}

function entry(id: string, foodId: string, grams: number): LogEntry {
  return { id: id as LogEntryId, foodId: foodId as FoodId, grams };
}

function separator(id: string, label: string): SectionSeparator {
  return { type: "separator", id: id as LogEntryId, label };
}

function dayLog(date: string, entries: DayLogItem[], extra: Partial<DayLog> = {}): DayLog {
  return { date, entries, ...extra };
}

function profile(id: string, overrides: Partial<Profile> = {}): Profile {
  return {
    id: id as ProfileId,
    name: id,
    dayLogs: [],
    createdAt: T0,
    goals: null,
    schedule: null,
    userMetrics: null,
    weightLossPlan: null,
    ...overrides,
  };
}

function mealPlan(id: string, name: string): SavedMealPlan {
  return { id: id as MealPlanId, name, entries: [], createdAt: T0, updatedAt: T0 };
}

function appData(overrides: Partial<AppData> = {}): AppData {
  return {
    foods: [],
    profiles: [],
    activeProfileId: null,
    deletedDayLogEntries: [],
    deletedFoods: [],
    deletedProfiles: [],
    ...overrides,
  };
}

function ids(items: ReadonlyArray<{ id: string }>): string[] {
  return items.map((item) => item.id);
}

function onlyProfile(data: AppData): Profile {
  assert.equal(data.profiles.length, 1);
  const [first] = data.profiles;
  assert.ok(first != null);
  return first;
}

function onlyDay(data: AppData): DayLog {
  const days = onlyProfile(data).dayLogs;
  assert.equal(days.length, 1);
  const [first] = days;
  assert.ok(first != null);
  return first;
}

const PLAN: WeightLossPlan = {
  startDate: "2026-04-01",
  startWeightKg: 90,
  targetWeightKg: 80,
  weeklyLossRateKg: 0.5,
};

const METRICS: UserMetrics = {
  sex: "male",
  age: 30,
  heightCm: 180,
  weightKg: 85,
  activityLevel: "sedentary",
  targetWeightKg: 80,
  proteinPerKg: 1.8,
  weightLossRateKg: 0.5,
};

describe("mergeAppData: foods", () => {
  it("keeps the cloud copy of a food both sides have (pins nutriapp-1: cloud wins on load)", () => {
    const merged = mergeAppData(
      appData({ foods: [food("f1", "Oats (edited on this device)")] }),
      appData({ foods: [food("f1", "Oats")] }),
    );
    assert.deepEqual(
      merged.foods.map((f) => f.name),
      ["Oats"],
    );
  });

  it("appends foods only this device has after the cloud's foods", () => {
    const merged = mergeAppData(
      appData({ foods: [food("f2", "Rice"), food("f1", "Oats")] }),
      appData({ foods: [food("f1", "Oats"), food("f3", "Beans")] }),
    );
    assert.deepEqual(ids(merged.foods), ["f1", "f3", "f2"]);
  });

  it("drops a food deleted on the other side, and the log entries that used it", () => {
    const local = appData({
      foods: [food("f1", "Oats"), food("f2", "Rice")],
      profiles: [
        profile("p1", {
          dayLogs: [dayLog(DAY, [entry("e1", "f1", 50), entry("e2", "f2", 80)])],
        }),
      ],
    });
    const cloud = appData({
      foods: [food("f1", "Oats")],
      profiles: [profile("p1", { dayLogs: [dayLog(DAY, [entry("e1", "f1", 50)])] })],
      deletedFoods: [{ foodId: "f2" as FoodId, deletedAt: T1 }],
    });

    const merged = mergeAppData(local, cloud);

    assert.deepEqual(ids(merged.foods), ["f1"]);
    assert.deepEqual(ids(onlyDay(merged).entries), ["e1"]);
    assert.deepEqual(merged.deletedFoods, [{ foodId: "f2", deletedAt: T1 }]);
  });

  it("keeps a food whose tombstone was restored later than it was deleted", () => {
    const merged = mergeAppData(
      appData({
        foods: [food("f2", "Rice")],
        deletedFoods: [{ foodId: "f2" as FoodId, deletedAt: T0, restoredAt: T2 }],
      }),
      appData({ deletedFoods: [{ foodId: "f2" as FoodId, deletedAt: T1 }] }),
    );
    assert.deepEqual(ids(merged.foods), ["f2"]);
    assert.deepEqual(merged.deletedFoods, [
      { foodId: "f2", deletedAt: T1, restoredAt: T2 },
    ]);
  });
});

describe("mergeAppData: profiles", () => {
  it("takes the cloud's fields for a profile both sides have (pins nutriapp-1)", () => {
    const merged = mergeAppData(
      appData({ profiles: [profile("p1", { name: "Renamed here" })] }),
      appData({ profiles: [profile("p1", { name: "Max" })] }),
    );
    assert.equal(onlyProfile(merged).name, "Max");
  });

  it("brings back a weight plan and metrics the cloud cleared (pins nutriapp-c1)", () => {
    // "Clear weight plan" on another device leaves null in the cloud; a stale
    // copy on this device fills it back in because the merge is `cloud ?? local`.
    const merged = mergeAppData(
      appData({ profiles: [profile("p1", { weightLossPlan: PLAN, userMetrics: METRICS })] }),
      appData({ profiles: [profile("p1")] }),
    );
    assert.deepEqual(onlyProfile(merged).weightLossPlan, PLAN);
    assert.deepEqual(onlyProfile(merged).userMetrics, METRICS);
  });

  it("takes the cloud's meal-plan list wholesale, dropping a plan only this device has (pins nutriapp-1)", () => {
    const merged = mergeAppData(
      appData({ profiles: [profile("p1", { mealPlans: [mealPlan("A", "Cut"), mealPlan("B", "Bulk")] })] }),
      appData({ profiles: [profile("p1", { mealPlans: [mealPlan("A", "Cut")] })] }),
    );
    assert.deepEqual(ids(onlyProfile(merged).mealPlans ?? []), ["A"]);
  });

  it("falls back to this device's meal plans and weekly plan when the cloud has none", () => {
    const weeklyPlan = { 1: [entry("w1", "f1", 100)] };
    const merged = mergeAppData(
      appData({ profiles: [profile("p1", { mealPlans: [mealPlan("A", "Cut")], weeklyPlan })] }),
      appData({ profiles: [profile("p1")] }),
    );
    assert.deepEqual(ids(onlyProfile(merged).mealPlans ?? []), ["A"]);
    assert.deepEqual(onlyProfile(merged).weeklyPlan, weeklyPlan);
  });

  it("keeps profiles from both sides, cloud's first", () => {
    const merged = mergeAppData(
      appData({ profiles: [profile("local-only"), profile("shared")] }),
      appData({ profiles: [profile("shared"), profile("cloud-only")] }),
    );
    assert.deepEqual(ids(merged.profiles), ["shared", "cloud-only", "local-only"]);
  });

  it("prefers the cloud's active profile and falls back to this device's", () => {
    const both = [profile("p1"), profile("p2")];
    assert.equal(
      mergeAppData(
        appData({ profiles: both, activeProfileId: "p1" as ProfileId }),
        appData({ profiles: both, activeProfileId: "p2" as ProfileId }),
      ).activeProfileId,
      "p2",
    );
    assert.equal(
      mergeAppData(
        appData({ profiles: both, activeProfileId: "p1" as ProfileId }),
        appData({ profiles: both, activeProfileId: null }),
      ).activeProfileId,
      "p1",
    );
  });

  it("drops a deleted profile and moves the active profile to the first one left", () => {
    const merged = mergeAppData(
      appData({ profiles: [profile("p1"), profile("p2")], activeProfileId: "p2" as ProfileId }),
      appData({
        profiles: [profile("p1")],
        activeProfileId: "p2" as ProfileId,
        deletedProfiles: [{ profileId: "p2" as ProfileId, deletedAt: T1 }],
      }),
    );
    assert.deepEqual(ids(merged.profiles), ["p1"]);
    assert.equal(merged.activeProfileId, "p1");
  });
});

describe("mergeAppData: day logs", () => {
  it("keeps the cloud's version of an entry both sides have (pins nutriapp-1)", () => {
    const merged = mergeAppData(
      appData({ profiles: [profile("p1", { dayLogs: [dayLog(DAY, [entry("e1", "f1", 150)])] })] }),
      appData({ profiles: [profile("p1", { dayLogs: [dayLog(DAY, [entry("e1", "f1", 100)])] })] }),
    );
    assert.deepEqual(onlyDay(merged).entries, [entry("e1", "f1", 100)]);
  });

  it("appends entries only this device has at the end of the day, under the last section (pins nutriapp-c1)", () => {
    // The salad was logged under Lunch on this device. Sections are defined by
    // the position of the separators, so after the merge it sits under Dinner.
    const local = [
      separator("s-breakfast", "Breakfast"),
      entry("e-oats", "f1", 50),
      separator("s-lunch", "Lunch"),
      entry("e-rice", "f1", 150),
      entry("e-salad", "f1", 200),
      separator("s-dinner", "Dinner"),
      entry("e-steak", "f1", 250),
    ];
    const cloud = local.filter((item) => item.id !== "e-salad");

    const merged = mergeAppData(
      appData({ profiles: [profile("p1", { dayLogs: [dayLog(DAY, local)] })] }),
      appData({ profiles: [profile("p1", { dayLogs: [dayLog(DAY, cloud)] })] }),
    );

    assert.deepEqual(ids(onlyDay(merged).entries), [
      "s-breakfast",
      "e-oats",
      "s-lunch",
      "e-rice",
      "s-dinner",
      "e-steak",
      "e-salad",
    ]);
  });

  it("brings back a weight the cloud cleared (pins nutriapp-c1)", () => {
    const merged = mergeAppData(
      appData({
        profiles: [
          profile("p1", {
            dayLogs: [dayLog(DAY, [], { weightKg: 82.4, weightNotes: "after run" })],
          }),
        ],
      }),
      appData({ profiles: [profile("p1", { dayLogs: [dayLog(DAY, [])] })] }),
    );
    assert.equal(onlyDay(merged).weightKg, 82.4);
    assert.equal(onlyDay(merged).weightNotes, "after run");
  });

  it("keeps the cloud's weight when both sides have one", () => {
    const merged = mergeAppData(
      appData({ profiles: [profile("p1", { dayLogs: [dayLog(DAY, [], { weightKg: 82.4 })] })] }),
      appData({ profiles: [profile("p1", { dayLogs: [dayLog(DAY, [], { weightKg: 81.9 })] })] }),
    );
    assert.equal(onlyDay(merged).weightKg, 81.9);
  });

  it("keeps days from both sides, cloud's first", () => {
    const merged = mergeAppData(
      appData({ profiles: [profile("p1", { dayLogs: [dayLog("2026-07-02", []), dayLog("2026-07-01", [])] })] }),
      appData({ profiles: [profile("p1", { dayLogs: [dayLog("2026-07-01", []), dayLog("2026-07-03", [])] })] }),
    );
    assert.deepEqual(
      onlyProfile(merged).dayLogs.map((d) => d.date),
      ["2026-07-01", "2026-07-03", "2026-07-02"],
    );
  });

  it("removes an entry deleted on either side and merges both sides' tombstones", () => {
    const local = appData({
      profiles: [
        profile("p1", {
          dayLogs: [dayLog(DAY, [entry("e1", "f1", 50), entry("e2", "f1", 60), entry("e3", "f1", 70)])],
        }),
      ],
      deletedDayLogEntries: [{ profileId: P1, date: DAY, entryId: "e3" as LogEntryId, deletedAt: T1 }],
    });
    const cloud = appData({
      profiles: [profile("p1", { dayLogs: [dayLog(DAY, [entry("e1", "f1", 50), entry("e3", "f1", 70)])] })],
      deletedDayLogEntries: [{ profileId: P1, date: DAY, entryId: "e2" as LogEntryId, deletedAt: T1 }],
    });

    const merged = mergeAppData(local, cloud);

    assert.deepEqual(ids(onlyDay(merged).entries), ["e1"]);
    assert.deepEqual(
      merged.deletedDayLogEntries.map((t) => t.entryId).sort(),
      ["e2", "e3"],
    );
  });

  it("keeps an entry whose deletion was undone more recently", () => {
    const merged = mergeAppData(
      appData({
        profiles: [profile("p1", { dayLogs: [dayLog(DAY, [entry("e1", "f1", 50)])] })],
        deletedDayLogEntries: [
          { profileId: P1, date: DAY, entryId: "e1" as LogEntryId, deletedAt: T0, restoredAt: T2 },
        ],
      }),
      appData({
        profiles: [profile("p1", { dayLogs: [dayLog(DAY, [])] })],
        deletedDayLogEntries: [{ profileId: P1, date: DAY, entryId: "e1" as LogEntryId, deletedAt: T1 }],
      }),
    );
    assert.deepEqual(ids(onlyDay(merged).entries), ["e1"]);
  });
});

describe("planCloudPull", () => {
  it("brings an entry logged on another device into this one", () => {
    const synced = { mealPlans: [], weeklyPlan: {} };
    const local = appData({
      activeProfileId: P1,
      profiles: [
        profile("p1", { ...synced, dayLogs: [dayLog(DAY, [entry("e1", "f1", 100)])] }),
      ],
    });
    const cloud = appData({
      activeProfileId: P1,
      profiles: [
        profile("p1", {
          ...synced,
          dayLogs: [dayLog(DAY, [entry("e1", "f1", 100), entry("e2", "f1", 50)])],
        }),
      ],
    });
    const plan = planCloudPull(local, cloud);
    assert.deepEqual(ids(onlyDay(plan.merged).entries), ["e1", "e2"]);
    assert.equal(plan.localChanged, true);
    assert.equal(plan.cloudChanged, false);
  });

  it("pushes back what only this device has", () => {
    const local = appData({ foods: [food("f1", "Rice"), food("f2", "Beans")] });
    const cloud = appData({ foods: [food("f1", "Rice")] });
    const plan = planCloudPull(local, cloud);
    assert.deepEqual(ids(plan.merged.foods), ["f1", "f2"]);
    assert.equal(plan.localChanged, false);
    assert.equal(plan.cloudChanged, true);
  });

  it("reports no change when the two differ only in key order", () => {
    const local = appData({ foods: [food("f1", "Rice")] });
    const reordered = Object.fromEntries(
      Object.entries(food("f1", "Rice")).reverse(),
    ) as Food;
    const cloud: AppData = {
      deletedProfiles: [],
      deletedFoods: [],
      deletedDayLogEntries: [],
      activeProfileId: null,
      profiles: [],
      foods: [reordered],
    };
    const plan = planCloudPull(local, cloud);
    assert.equal(plan.localChanged, false);
    assert.equal(plan.cloudChanged, false);
  });

  it("is a no-op on the second pull once both sides hold the merge", () => {
    const local = appData({
      profiles: [profile("p1", { dayLogs: [dayLog(DAY, [entry("e1", "f1", 100)])] })],
    });
    const cloud = appData({
      foods: [food("f1", "Rice")],
      profiles: [profile("p1", { dayLogs: [dayLog(DAY, [entry("e2", "f1", 50)])] })],
    });
    const { merged } = planCloudPull(local, cloud);
    const again = planCloudPull(merged, merged);
    assert.equal(again.localChanged, false);
    assert.equal(again.cloudChanged, false);
  });
});
