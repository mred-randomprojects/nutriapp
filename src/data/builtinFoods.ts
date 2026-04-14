import type { Food, FoodId } from "../types";
import rawFoods from "./foods.json";

interface RawBuiltinFood {
  id: string;
  name: string;
  barcode: string | null;
  imageUrl: string | null;
  nutritionPer100g: {
    calories: number;
    protein: number;
    saturatedFat: number;
    fiber: number;
  };
  gramsPerUnit: number | null;
}

export const builtinFoods: Food[] = (rawFoods as RawBuiltinFood[]).map(
  (raw) => ({
    id: raw.id as FoodId,
    name: raw.name,
    imageUrl: raw.imageUrl,
    nutritionPer100g: raw.nutritionPer100g,
    gramsPerUnit: raw.gramsPerUnit,
    ingredients: null,
    createdAt: "builtin",
  }),
);

const builtinIds = new Set(builtinFoods.map((f) => f.id));

export function isBuiltinFood(foodId: FoodId): boolean {
  return builtinIds.has(foodId);
}
