/**
 * Branded string types for type-safe IDs.
 */
export type FoodId = string & { readonly __brand: "FoodId" };
export type ProfileId = string & { readonly __brand: "ProfileId" };
export type LogEntryId = string & { readonly __brand: "LogEntryId" };

export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Nutritional values for a food, always stored per 100g internally.
 */
export interface NutritionPer100g {
  calories: number;
  protein: number;
  saturatedFat: number;
  fiber: number;
}

export interface ComboIngredient {
  foodId: FoodId;
  grams: number;
}

/**
 * A food item in the database.
 * If gramsPerUnit is set, the food can be logged by unit count (e.g. 1 alfajor = 40g).
 * All foods can always be logged by grams directly.
 * If ingredients is non-null, the food is a combo whose nutrition is computed
 * dynamically from its ingredients.
 */
export interface Food {
  id: FoodId;
  name: string;
  imageUrl: string | null;
  nutritionPer100g: NutritionPer100g;
  gramsPerUnit: number | null;
  ingredients: ReadonlyArray<ComboIngredient> | null;
  createdAt: string;
}

/**
 * A single log entry — always stores the total grams consumed.
 * The optional `type` field is used as a discriminant for DayLogItem union.
 */
export interface LogEntry {
  type?: undefined;
  id: LogEntryId;
  foodId: FoodId;
  grams: number;
}

/**
 * A visual separator/header in the daily log (e.g. "Breakfast", "Lunch").
 */
export interface SectionSeparator {
  type: "separator";
  id: LogEntryId;
  label: string;
}

export type DayLogItem = LogEntry | SectionSeparator;

/**
 * All log items for a specific date within a profile.
 */
export interface DayLog {
  date: string;
  entries: DayLogItem[];
}

/**
 * A tracking profile / "book" — an independent tracking context.
 */
export interface Profile {
  id: ProfileId;
  name: string;
  dayLogs: DayLog[];
  createdAt: string;
}

/**
 * The full application state stored in localStorage.
 */
export interface AppData {
  foods: Food[];
  profiles: Profile[];
  activeProfileId: ProfileId | null;
}
