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
import type { AppData, DeletedFood, FoodId, Food } from "./types.js";

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
