import type { DayLogItem, Food, LogEntry, NutritionPer100g } from "./types";

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
