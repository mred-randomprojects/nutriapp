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

/**
 * A food item in the database.
 * If gramsPerUnit is set, the food can be logged by unit count (e.g. 1 alfajor = 40g).
 * All foods can always be logged by grams directly.
 */
export interface Food {
  id: FoodId;
  name: string;
  imageUrl: string | null;
  nutritionPer100g: NutritionPer100g;
  gramsPerUnit: number | null;
  createdAt: string;
}

/**
 * A single log entry — always stores the total grams consumed.
 */
export interface LogEntry {
  id: LogEntryId;
  foodId: FoodId;
  grams: number;
}

/**
 * All log entries for a specific date within a profile.
 */
export interface DayLog {
  date: string;
  entries: LogEntry[];
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
