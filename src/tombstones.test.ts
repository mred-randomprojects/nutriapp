import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isTombstoneActive,
  mergeTombstonePair,
  reconcileTombstonesForRestore,
} from "./tombstones.js";
import {
  buildDeletedFoodSet,
  mergeDeletedFoods,
} from "./deletedAppEntities.js";
import { mergeAppData } from "./mergeAppData.js";
import type {
  AppData,
  DayLogItem,
  DeletedFood,
  FoodId,
  Food,
  LogEntryId,
  Profile,
  ProfileId,
} from "./types.js";

const T0 = "2026-07-01T00:00:00.000Z";
const T1 = "2026-07-02T00:00:00.000Z";
const T2 = "2026-07-03T00:00:00.000Z";

function food(id: string, name: string): Food {
  return {
    id: id as FoodId,
    name,
    imageUrl: null,
    nutritionPer100g: { calories: 0, protein: 0, saturatedFat: 0, fiber: 0 },
    nutritionPerUnit: null,
    gramsPerUnit: null,
    ingredients: null,
    createdAt: T0,
  };
}

function profile(id: string, entries: DayLogItem[] = []): Profile {
  return {
    id: id as ProfileId,
    name: id,
    dayLogs: entries.length > 0 ? [{ date: DAY, entries }] : [],
    createdAt: T0,
    goals: null,
    schedule: null,
    userMetrics: null,
    weightLossPlan: null,
    mealPlans: [],
    weeklyPlan: {},
  };
}

function entry(id: string, grams = 100): DayLogItem {
  return { id: id as LogEntryId, foodId: "f1" as FoodId, grams };
}

const DAY = "2026-07-10";

function entryIds(data: AppData): string[] {
  return data.profiles.flatMap((p) => p.dayLogs.flatMap((d) => d.entries.map((e) => e.id)));
}

function emptyAppData(overrides: Partial<AppData> = {}): AppData {
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

describe("tombstone status", () => {
  it("is active when never restored", () => {
    assert.equal(isTombstoneActive({ deletedAt: T1 }), true);
  });

  it("is inactive when restored more recently than deleted", () => {
    assert.equal(isTombstoneActive({ deletedAt: T1, restoredAt: T2 }), false);
  });

  it("is active when deleted after the last restore", () => {
    assert.equal(isTombstoneActive({ deletedAt: T2, restoredAt: T1 }), true);
  });
});

describe("mergeTombstonePair", () => {
  it("keeps the max of each timestamp independently", () => {
    const a: DeletedFood = { foodId: "f" as FoodId, deletedAt: T2, restoredAt: T0 };
    const b: DeletedFood = { foodId: "f" as FoodId, deletedAt: T0, restoredAt: T1 };
    const merged = mergeTombstonePair(a, b);
    assert.equal(merged.deletedAt, T2);
    assert.equal(merged.restoredAt, T1);
  });

  it("a restore that is newer than any delete wins the merge", () => {
    const cloudDelete: DeletedFood = { foodId: "f" as FoodId, deletedAt: T1 };
    const localRestore: DeletedFood = {
      foodId: "f" as FoodId,
      deletedAt: T1,
      restoredAt: T2,
    };
    const merged = mergeTombstonePair(cloudDelete, localRestore);
    assert.equal(isTombstoneActive(merged), false);
  });
});

describe("reconcileTombstonesForRestore", () => {
  it("un-deletes a food and survives a stale cloud tombstone", () => {
    const deletedFoodId = "f1" as FoodId;

    // Target = the snapshot BEFORE the delete: food present, no tombstone.
    const target = emptyAppData({ foods: [food(deletedFoodId, "Oats")] });

    // Current = after deleting: food gone, active tombstone.
    const current = emptyAppData({
      foods: [],
      deletedFoods: [{ foodId: deletedFoodId, deletedAt: T1 }],
    });

    const restored = reconcileTombstonesForRestore(target, current, T2);

    // The food is back...
    assert.equal(restored.foods.length, 1);
    // ...and the tombstone is stamped restored so it is no longer "deleted".
    const tombstone = restored.deletedFoods[0];
    assert.equal(tombstone.foodId, deletedFoodId);
    assert.equal(tombstone.restoredAt, T2);
    assert.equal(isTombstoneActive(tombstone), false);

    // The cloud still holds the original delete tombstone. After the next sync
    // the merge must NOT re-delete the food.
    const mergedTombstones = mergeDeletedFoods(restored.deletedFoods, [
      { foodId: deletedFoodId, deletedAt: T1 },
    ]);
    assert.equal(buildDeletedFoodSet(mergedTombstones).has(deletedFoodId), false);
  });

  it("re-deletes on redo, beating the earlier restore", () => {
    const deletedFoodId = "f1" as FoodId;

    // Target = the "after delete" snapshot we want to reach via redo.
    const target = emptyAppData({
      foods: [],
      deletedFoods: [{ foodId: deletedFoodId, deletedAt: T1 }],
    });

    // Current = the restored state (undo already happened): food live again.
    const current = emptyAppData({
      foods: [food(deletedFoodId, "Oats")],
      deletedFoods: [{ foodId: deletedFoodId, deletedAt: T1, restoredAt: T2 }],
    });

    const now = "2026-07-04T00:00:00.000Z";
    const restored = reconcileTombstonesForRestore(target, current, now);

    const tombstone = restored.deletedFoods[0];
    assert.equal(isTombstoneActive(tombstone), true);
    assert.equal(tombstone.deletedAt, now);
    assert.equal(buildDeletedFoodSet(restored.deletedFoods).has(deletedFoodId), true);
  });

  it("leaves tombstones untouched when nothing changed", () => {
    const target = emptyAppData({
      deletedFoods: [{ foodId: "f" as FoodId, deletedAt: T1 }],
    });
    const current = emptyAppData({
      deletedFoods: [{ foodId: "f" as FoodId, deletedAt: T1 }],
    });
    const restored = reconcileTombstonesForRestore(target, current, T2);
    assert.deepEqual(restored.deletedFoods, [
      { foodId: "f" as FoodId, deletedAt: T1 },
    ]);
  });
});

describe("reconcileTombstonesForRestore: undoing an addition", () => {
  const NOW = "2026-07-04T00:00:00.000Z";

  it("tombstones the entry, food and profile the undo removes", () => {
    const before = emptyAppData({ profiles: [profile("p1", [entry("e1")])] });
    const after = emptyAppData({
      foods: [food("f2", "Rice")],
      profiles: [profile("p1", [entry("e1"), entry("e2")]), profile("p2")],
    });

    const undone = reconcileTombstonesForRestore(before, after, NOW);

    assert.deepEqual(undone.deletedDayLogEntries, [
      { profileId: "p1", date: DAY, entryId: "e2", deletedAt: NOW },
    ]);
    assert.deepEqual(undone.deletedFoods, [{ foodId: "f2", deletedAt: NOW }]);
    assert.deepEqual(undone.deletedProfiles, [{ profileId: "p2", deletedAt: NOW }]);
  });

  it("makes a device that already pulled the undone entry drop it (nutriapp undo-add-resurrects)", () => {
    const before = emptyAppData({ profiles: [profile("p1", [entry("e1")])] });
    const after = emptyAppData({ profiles: [profile("p1", [entry("e1"), entry("e2")])] });
    const undone = reconcileTombstonesForRestore(before, after, NOW);

    // The phone pulled `after` before the undo: e2 is in its own copy. It
    // merges the cloud's copy, which is now the undone state.
    const phone = mergeAppData(after, undone);
    assert.deepEqual(entryIds(phone), ["e1"]);
    // And the cloud, merging the phone's copy back, keeps it gone.
    assert.deepEqual(entryIds(mergeAppData(phone, undone)), ["e1"]);
  });

  it("tombstones every entry an undone meal-plan apply added, separators included", () => {
    const before = emptyAppData({ profiles: [profile("p1", [entry("e1")])] });
    const after = emptyAppData({
      profiles: [
        profile("p1", [
          entry("e1"),
          { type: "separator", id: "s1" as LogEntryId, label: "Lunch" },
          entry("e2"),
          entry("e3"),
        ]),
      ],
    });
    const undone = reconcileTombstonesForRestore(before, after, NOW);
    assert.deepEqual(
      undone.deletedDayLogEntries.map((t) => t.entryId).sort(),
      ["e2", "e3", "s1"],
    );
  });

  it("redo brings the addition back, and the restore beats the undo's tombstone", () => {
    const before = emptyAppData({ profiles: [profile("p1", [entry("e1")])] });
    const after = emptyAppData({ profiles: [profile("p1", [entry("e1"), entry("e2")])] });
    const undone = reconcileTombstonesForRestore(before, after, NOW);
    const later = "2026-07-05T00:00:00.000Z";
    const redone = reconcileTombstonesForRestore(after, undone, later);

    assert.deepEqual(entryIds(redone), ["e1", "e2"]);
    // A device still holding the undo's tombstone does not re-delete it.
    assert.deepEqual(entryIds(mergeAppData(undone, redone)), ["e1", "e2"]);
  });

  it("adds no tombstone when the undo only changes values", () => {
    const before = emptyAppData({ profiles: [profile("p1", [entry("e1", 100)])] });
    const after = emptyAppData({ profiles: [profile("p1", [entry("e1", 150)])] });
    const undone = reconcileTombstonesForRestore(before, after, NOW);
    assert.deepEqual(undone.deletedDayLogEntries, []);
    assert.deepEqual(undone.deletedFoods, []);
    assert.deepEqual(undone.deletedProfiles, []);
  });

  it("keeps an entry deleted when the undo goes back past both its addition and its deletion", () => {
    // History: add e2, then delete e2. Undoing both lands on a snapshot that
    // never had e2 and has no tombstone for it either.
    const before = emptyAppData({ profiles: [profile("p1", [entry("e1")])] });
    const current = emptyAppData({
      profiles: [profile("p1", [entry("e1")])],
      deletedDayLogEntries: [{ profileId: "p1" as ProfileId, date: DAY, entryId: "e2" as LogEntryId, deletedAt: T1 }],
    });
    const undone = reconcileTombstonesForRestore(before, current, NOW);

    // A device that still has e2 (it pulled between the add and the delete)
    // must drop it, not get it back everywhere.
    const phone = emptyAppData({ profiles: [profile("p1", [entry("e1"), entry("e2")])] });
    assert.deepEqual(entryIds(mergeAppData(phone, undone)), ["e1"]);
  });

  it("gives the entries of a removed profile no tombstones of their own", () => {
    const before = emptyAppData();
    const after = emptyAppData({ profiles: [profile("p2", [entry("e1"), entry("e2")])] });
    const undone = reconcileTombstonesForRestore(before, after, NOW);
    assert.deepEqual(undone.deletedProfiles, [{ profileId: "p2", deletedAt: NOW }]);
    assert.deepEqual(undone.deletedDayLogEntries, []);
  });
});
