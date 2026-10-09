import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildResolvedFoodsMap,
  comboServingNutrition,
  comboTotalGrams,
  computeComboNutritionPer100g,
  getTimeBudgetFraction,
  nutritionForEntry,
  sumNutrition,
} from "./nutrition.js";
import type {
  ComboIngredient,
  DayLogItem,
  Food,
  FoodId,
  LogEntry,
  LogEntryId,
  NutritionValues,
} from "./types.js";

const T0 = "2026-07-01T00:00:00.000Z";

function food(id: string, per100g: NutritionValues, extra: Partial<Food> = {}): Food {
  return {
    id: id as FoodId,
    name: id,
    imageUrl: null,
    nutritionPer100g: per100g,
    nutritionPerUnit: null,
    gramsPerUnit: null,
    ingredients: null,
    createdAt: T0,
    ...extra,
  };
}

function entry(id: string, foodId: string, grams: number, extra: Partial<LogEntry> = {}): LogEntry {
  return { id: id as LogEntryId, foodId: foodId as FoodId, grams, ...extra };
}

function ingredient(foodId: string, grams: number): ComboIngredient {
  return { foodId: foodId as FoodId, grams };
}

function nutrition(calories: number, protein: number, saturatedFat: number, fiber: number): NutritionValues {
  return { calories, protein, saturatedFat, fiber };
}

/** A local time on an arbitrary day: the budget only reads hours and minutes. */
function at(hours: number, minutes = 0): Date {
  return new Date(2026, 6, 10, hours, minutes);
}

const OATS = food("oats", nutrition(200, 10, 2, 5));
const BAR = food("bar", nutrition(400, 20, 8, 4), {
  nutritionPerUnit: nutrition(120, 2, 3, 0.5),
});

describe("nutritionForEntry", () => {
  it("scales the per-100 g values by the entry's grams", () => {
    assert.deepEqual(nutritionForEntry(entry("e1", "oats", 150), OATS), nutrition(300, 15, 3, 7.5));
  });

  it("uses the per-unit values when the entry has units and the food has them", () => {
    assert.deepEqual(
      nutritionForEntry(entry("e1", "bar", 80, { units: 2 }), BAR),
      nutrition(240, 4, 6, 1),
    );
  });

  it("falls back to grams when the food has no per-unit values", () => {
    assert.deepEqual(
      nutritionForEntry(entry("e1", "oats", 150, { units: 3 }), OATS),
      nutrition(300, 15, 3, 7.5),
    );
  });

  it("rounds each value to one decimal", () => {
    const odd = food("odd", nutrition(333, 7, 1.11, 2.5));
    assert.deepEqual(nutritionForEntry(entry("e1", "odd", 33), odd), nutrition(109.9, 2.3, 0.4, 0.8));
  });
});

describe("sumNutrition", () => {
  const foodsMap = new Map<string, Food>([
    [OATS.id, OATS],
    [BAR.id, BAR],
  ]);
  const items: DayLogItem[] = [
    { type: "separator", id: "s1" as LogEntryId, label: "Breakfast" },
    entry("e1", "oats", 100),
    {
      type: "quick-add",
      id: "q1" as LogEntryId,
      name: "Coffee",
      nutrition: nutrition(50, 1, 0.5, 0),
    },
    entry("e2", "oats", 50, { isBudgeted: true }),
    entry("e3", "missing-food", 500),
  ];

  it("adds food entries and quick-adds, skipping separators and unknown foods", () => {
    assert.deepEqual(sumNutrition(items, foodsMap), nutrition(350, 16, 3.5, 7.5));
  });

  it("counts only consumed items with status 'consumed'", () => {
    assert.deepEqual(sumNutrition(items, foodsMap, { status: "consumed" }), nutrition(250, 11, 2.5, 5));
  });

  it("counts only budgeted items with status 'budgeted'", () => {
    assert.deepEqual(sumNutrition(items, foodsMap, { status: "budgeted" }), nutrition(100, 5, 1, 2.5));
  });

  it("returns zeros for an empty day", () => {
    assert.deepEqual(sumNutrition([], foodsMap), nutrition(0, 0, 0, 0));
  });
});

describe("getTimeBudgetFraction", () => {
  const schedule = { wakeHour: 8, sleepHour: 22 };

  it("is 0 until wake-up and 1 from bedtime on", () => {
    assert.equal(getTimeBudgetFraction(at(6), schedule), 0);
    assert.equal(getTimeBudgetFraction(at(8), schedule), 0);
    assert.equal(getTimeBudgetFraction(at(22), schedule), 1);
    assert.equal(getTimeBudgetFraction(at(23, 30), schedule), 1);
  });

  it("grows linearly through the waking hours", () => {
    assert.equal(getTimeBudgetFraction(at(15), schedule), 0.5);
    assert.equal(getTimeBudgetFraction(at(11, 30), schedule), 0.25);
  });

  it("defaults to a 7:00–23:00 day without a schedule", () => {
    assert.equal(getTimeBudgetFraction(at(15), null), 0.5);
  });

  it("is 1 when the schedule has no waking hours", () => {
    assert.equal(getTimeBudgetFraction(at(12), { wakeHour: 22, sleepHour: 8 }), 1);
  });
});

describe("combo foods", () => {
  const RICE = food("rice", nutrition(100, 2, 0, 1));
  const baseMap = new Map<string, Food>([
    [OATS.id, OATS],
    [RICE.id, RICE],
  ]);
  const bowl = [ingredient("oats", 100), ingredient("rice", 300)];

  it("totals the ingredient grams", () => {
    assert.equal(comboTotalGrams(bowl), 400);
  });

  it("computes one serving and the per-100 g values from the ingredients", () => {
    assert.deepEqual(comboServingNutrition(bowl, baseMap), nutrition(500, 16, 2, 8));
    assert.deepEqual(computeComboNutritionPer100g(bowl, baseMap), nutrition(125, 4, 0.5, 2));
  });

  it("returns zeros for a combo with no grams", () => {
    assert.deepEqual(computeComboNutritionPer100g([], baseMap), nutrition(0, 0, 0, 0));
  });

  it("resolves nested combos whatever their order in the list", () => {
    const outer = food("outer", nutrition(0, 0, 0, 0), {
      ingredients: [ingredient("inner", 200), ingredient("rice", 200)],
    });
    const inner = food("inner", nutrition(0, 0, 0, 0), {
      ingredients: [ingredient("oats", 100), ingredient("rice", 100)],
    });

    const map = buildResolvedFoodsMap([outer, OATS, inner, RICE]);

    assert.deepEqual(map.get("inner")?.nutritionPer100g, nutrition(150, 6, 1, 3));
    assert.equal(map.get("inner")?.gramsPerUnit, 200);
    assert.deepEqual(map.get("outer")?.nutritionPer100g, nutrition(125, 4, 0.5, 2));
    assert.equal(map.get("outer")?.gramsPerUnit, 400);
    assert.equal(map.get("outer")?.nutritionPerUnit, null);
  });

  it("leaves combos that never resolve (a cycle) as they were stored", () => {
    const a = food("a", nutrition(1, 1, 1, 1), { ingredients: [ingredient("b", 100)] });
    const b = food("b", nutrition(2, 2, 2, 2), { ingredients: [ingredient("a", 100)] });

    const map = buildResolvedFoodsMap([a, b]);

    assert.equal(map.get("a"), a);
    assert.equal(map.get("b"), b);
  });
});
