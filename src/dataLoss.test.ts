import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectDataLoss, describeDataLoss, restoreMissing, safetyCopyAfterMerge } from "./dataLoss.js";
import { mergeAppData } from "./mergeAppData.js";
import type { AppData, DayLogItem, FoodId, LogEntryId, MealPlanId, Profile, ProfileId } from "./types.js";

const T0 = "2026-10-01T00:00:00.000Z";
const NOW = "2026-10-21T12:00:00.000Z";
const DAY = "2026-10-20";

function entry(id: string): DayLogItem {
  return { id: id as LogEntryId, foodId: "f1" as FoodId, grams: 100 };
}

function profile(id: string, entries: DayLogItem[], weightKg?: number, plans: string[] = []): Profile {
  return {
    id: id as ProfileId,
    name: `name-${id}`,
    dayLogs: [{ date: DAY, entries, ...(weightKg != null ? { weightKg } : {}) }],
    createdAt: T0,
    goals: null,
    schedule: null,
    userMetrics: null,
    weightLossPlan: null,
    mealPlans: plans.map((p) => ({ id: p as MealPlanId, name: `plan-${p}`, entries: [], createdAt: T0, updatedAt: T0 })),
    weeklyPlan: {},
  };
}

function data(profiles: Profile[], foods: string[] = [], extra: Partial<AppData> = {}): AppData {
  return {
    foods: foods.map((id) => ({
      id: id as FoodId,
      name: `food-${id}`,
      imageUrl: null,
      nutritionPer100g: { calories: 1, protein: 1, saturatedFat: 1, fiber: 1 },
      nutritionPerUnit: null,
      gramsPerUnit: null,
      ingredients: null,
      createdAt: T0,
    })),
    profiles,
    activeProfileId: profiles[0]?.id ?? null,
    deletedDayLogEntries: [],
    deletedFoods: [],
    deletedProfiles: [],
    ...extra,
  };
}

describe("detectDataLoss", () => {
  it("is null when the merge only adds or changes values", () => {
    const before = data([profile("p1", [entry("e1")], 80)], ["f1"]);
    const after = data([profile("p1", [entry("e1"), entry("e2")], 81)], ["f1", "f2"]);
    assert.equal(detectDataLoss(before, after), null);
  });

  it("counts removed entries, weights, meal plans, foods and profiles", () => {
    const before = data([profile("p1", [entry("e1"), entry("e2")], 80, ["m1"]), profile("p2", [entry("e3")])], ["f1", "f2"]);
    const after = data([profile("p1", [entry("e1")], undefined, [])], ["f1"]);
    const loss = detectDataLoss(before, after);
    assert.deepEqual(loss, {
      profiles: ["name-p2"],
      foods: ["food-f2"],
      entries: 2,
      weights: 1,
      mealPlans: ["plan-m1"],
    });
    assert.equal(
      describeDataLoss(loss!),
      "1 profile (name-p2), 1 food (food-f2), 2 log entries, 1 weight and 1 meal plan (plan-m1)",
    );
  });
});

describe("detectDataLoss: ordinary deletes", () => {
  it("does not count entries, foods or profiles that a tombstone in `after` removed", () => {
    const before = data([profile("p1", [entry("e1"), entry("e2")]), profile("p2", [entry("e3")])], ["f1", "f2"]);
    const after = data([profile("p1", [entry("e1")])], ["f1"], {
      deletedDayLogEntries: [{ profileId: "p1" as ProfileId, date: DAY, entryId: "e2" as LogEntryId, deletedAt: NOW }],
      deletedFoods: [{ foodId: "f2" as FoodId, deletedAt: NOW }],
      deletedProfiles: [{ profileId: "p2" as ProfileId, deletedAt: NOW }],
    });
    assert.equal(detectDataLoss(before, after), null);
  });

  it("still counts a removal whose tombstone was restored, and one with no tombstone", () => {
    const before = data([profile("p1", [entry("e1"), entry("e2")])]);
    const after = data([profile("p1", [])], [], {
      deletedDayLogEntries: [
        { profileId: "p1" as ProfileId, date: DAY, entryId: "e1" as LogEntryId, deletedAt: T0, restoredAt: NOW },
      ],
    });
    assert.equal(detectDataLoss(before, after)?.entries, 2);
  });
});

describe("restoreMissing", () => {
  it("brings back what the copy has and the current data lacks, keeping the current versions and ordinary deletes", () => {
    const copy = data([profile("p1", [entry("e1"), entry("e2")], 80, ["m1"])], ["f1", "f2"]);
    const current = data([profile("p1", [{ ...entry("e1"), grams: 150 } as DayLogItem, entry("e9")], undefined, [])], ["f1"], {
      deletedDayLogEntries: [{ profileId: "p1" as ProfileId, date: DAY, entryId: "e2" as LogEntryId, deletedAt: "2026-10-20T00:00:00.000Z" }],
      deletedFoods: [{ foodId: "f2" as FoodId, deletedAt: "2026-10-20T00:00:00.000Z" }],
    });
    const restored = restoreMissing(current, copy, NOW);
    const day = restored.profiles[0].dayLogs[0];
    assert.deepEqual(day.entries.map((e) => e.id).sort(), ["e1", "e9"], "the tombstoned e2 stays deleted");
    assert.equal((day.entries.find((e) => e.id === "e1") as { grams: number }).grams, 150, "current version kept");
    assert.equal(day.weightKg, 80);
    assert.deepEqual(restored.profiles[0].mealPlans?.map((m) => m.id), ["m1"]);
    assert.deepEqual(restored.foods.map((f) => f.id), ["f1"], "the tombstoned f2 stays deleted");
    assert.equal(detectDataLoss(copy, restored), null);
    // A device still holding the tombstones keeps the restored items.
    const elsewhere = mergeAppData(current, restored);
    assert.equal(detectDataLoss(copy, elsewhere), null);
  });
});

describe("safetyCopyAfterMerge", () => {
  it("keeps nothing when the merge removed nothing, and the data from before when it did", () => {
    const before = data([profile("p1", [entry("e1"), entry("e2")])]);
    assert.equal(safetyCopyAfterMerge(null, before, before, NOW), null);
    const after = data([profile("p1", [entry("e1")])]);
    assert.deepEqual(safetyCopyAfterMerge(null, before, after, NOW), { savedAt: NOW, data: before });
  });

  it("adds a second loss to the copy it already keeps instead of replacing it", () => {
    const first = data([profile("p1", [entry("e1"), entry("e2")])]);
    const kept = safetyCopyAfterMerge(null, first, data([profile("p1", [entry("e1")])]), NOW)!;
    const second = data([profile("p1", [entry("e1"), entry("e3")])]);
    const copy = safetyCopyAfterMerge(kept, second, data([profile("p1", [])]), NOW)!;
    const ids = copy.data.profiles[0].dayLogs[0].entries.map((e) => e.id).sort();
    assert.deepEqual(ids, ["e1", "e2", "e3"]);
  });
});
