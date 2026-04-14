import type { ComboIngredient, DayLogItem, Food, LogEntry, NutritionPer100g } from "./types";

/**
 * Calculates the total nutrition for a single log entry.
 */
export function nutritionForEntry(
  entry: LogEntry,
  food: Food,
): NutritionPer100g {
  const factor = entry.grams / 100;
  return {
    calories: Math.round(food.nutritionPer100g.calories * factor * 10) / 10,
    protein: Math.round(food.nutritionPer100g.protein * factor * 10) / 10,
    saturatedFat:
      Math.round(food.nutritionPer100g.saturatedFat * factor * 10) / 10,
    fiber: Math.round(food.nutritionPer100g.fiber * factor * 10) / 10,
  };
}

/**
 * Sums up nutrition values from all food entries, skipping separators.
 */
export function sumNutrition(
  items: ReadonlyArray<DayLogItem>,
  foodsMap: Map<string, Food>,
): NutritionPer100g {
  const totals: NutritionPer100g = {
    calories: 0,
    protein: 0,
    saturatedFat: 0,
    fiber: 0,
  };

  for (const item of items) {
    if (item.type === "separator") continue;
    const food = foodsMap.get(item.foodId);
    if (food == null) continue;
    const entryNutrition = nutritionForEntry(item, food);
    totals.calories += entryNutrition.calories;
    totals.protein += entryNutrition.protein;
    totals.saturatedFat += entryNutrition.saturatedFat;
    totals.fiber += entryNutrition.fiber;
  }

  return {
    calories: Math.round(totals.calories * 10) / 10,
    protein: Math.round(totals.protein * 10) / 10,
    saturatedFat: Math.round(totals.saturatedFat * 10) / 10,
    fiber: Math.round(totals.fiber * 10) / 10,
  };
}

// --- Combo food helpers ---

export function comboTotalGrams(
  ingredients: ReadonlyArray<ComboIngredient>,
): number {
  return ingredients.reduce((sum, ing) => sum + ing.grams, 0);
}

function rawServingNutrition(
  ingredients: ReadonlyArray<ComboIngredient>,
  foodsMap: ReadonlyMap<string, Food>,
): NutritionPer100g {
  let calories = 0;
  let protein = 0;
  let saturatedFat = 0;
  let fiber = 0;

  for (const ing of ingredients) {
    const food = foodsMap.get(ing.foodId);
    if (food == null) continue;
    const factor = ing.grams / 100;
    calories += food.nutritionPer100g.calories * factor;
    protein += food.nutritionPer100g.protein * factor;
    saturatedFat += food.nutritionPer100g.saturatedFat * factor;
    fiber += food.nutritionPer100g.fiber * factor;
  }

  return { calories, protein, saturatedFat, fiber };
}

/**
 * Total nutrition for one full serving of a combo (all ingredients at their
 * specified gram amounts).
 */
export function comboServingNutrition(
  ingredients: ReadonlyArray<ComboIngredient>,
  foodsMap: ReadonlyMap<string, Food>,
): NutritionPer100g {
  const raw = rawServingNutrition(ingredients, foodsMap);
  return {
    calories: Math.round(raw.calories * 10) / 10,
    protein: Math.round(raw.protein * 10) / 10,
    saturatedFat: Math.round(raw.saturatedFat * 10) / 10,
    fiber: Math.round(raw.fiber * 10) / 10,
  };
}

/**
 * Nutrition per 100g for a combo food, derived from its ingredients.
 */
export function computeComboNutritionPer100g(
  ingredients: ReadonlyArray<ComboIngredient>,
  foodsMap: ReadonlyMap<string, Food>,
): NutritionPer100g {
  const raw = rawServingNutrition(ingredients, foodsMap);
  const totalGrams = comboTotalGrams(ingredients);

  if (totalGrams === 0) {
    return { calories: 0, protein: 0, saturatedFat: 0, fiber: 0 };
  }

  const normFactor = 100 / totalGrams;
  return {
    calories: Math.round(raw.calories * normFactor * 100) / 100,
    protein: Math.round(raw.protein * normFactor * 100) / 100,
    saturatedFat: Math.round(raw.saturatedFat * normFactor * 100) / 100,
    fiber: Math.round(raw.fiber * normFactor * 100) / 100,
  };
}

/**
 * Builds a foods map where combo foods have their nutritionPer100g and
 * gramsPerUnit dynamically computed from ingredients. Handles nested combos
 * via iterative resolution (topological ordering).
 */
export function buildResolvedFoodsMap(
  foods: ReadonlyArray<Food>,
): Map<string, Food> {
  const map = new Map<string, Food>();

  const comboEntries: Array<{
    food: Food;
    ingredients: ReadonlyArray<ComboIngredient>;
  }> = [];

  for (const food of foods) {
    if (food.ingredients == null) {
      map.set(food.id, food);
    } else {
      comboEntries.push({ food, ingredients: food.ingredients });
    }
  }

  let remaining = comboEntries;
  let maxIterations = comboEntries.length + 1;

  while (remaining.length > 0 && maxIterations > 0) {
    maxIterations--;
    const nextRemaining: typeof remaining = [];

    for (const { food, ingredients } of remaining) {
      const allDepsResolved = ingredients.every((ing) => map.has(ing.foodId));

      if (allDepsResolved) {
        const nutrition = computeComboNutritionPer100g(ingredients, map);
        const totalGrams = comboTotalGrams(ingredients);
        map.set(food.id, {
          ...food,
          nutritionPer100g: nutrition,
          gramsPerUnit: totalGrams > 0 ? totalGrams : null,
        });
      } else {
        nextRemaining.push({ food, ingredients });
      }
    }

    remaining = nextRemaining;
  }

  for (const { food } of remaining) {
    map.set(food.id, food);
  }

  return map;
}
