/**
 * Branded string types for type-safe IDs.
 */
export type FoodId = string & { readonly __brand: "FoodId" };
export type ProfileId = string & { readonly __brand: "ProfileId" };
export type LogEntryId = string & { readonly __brand: "LogEntryId" };
export type PlanWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Base shape for nutritional values (calories, protein, saturated fat, fiber).
 */
export interface NutritionValues {
  calories: number;
  protein: number;
  saturatedFat: number;
  fiber: number;
}

/**
 * Nutritional values for a food, always stored per 100g internally.
 */
export type NutritionPer100g = NutritionValues;

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
 * If nutritionPerUnit is set, the food is "unit-based" — its weight is unknown
 * and it can only be logged by unit count.
 */
export interface Food {
  id: FoodId;
  name: string;
  imageUrl: string | null;
  nutritionPer100g: NutritionPer100g;
  nutritionPerUnit: NutritionValues | null;
  gramsPerUnit: number | null;
  ingredients: ReadonlyArray<ComboIngredient> | null;
  createdAt: string;
}

/**
 * A single food log entry — always stores the total grams for the entry.
 * The optional `type` field is used as a discriminant for DayLogItem union.
 */
export interface LogEntry {
  type?: undefined;
  id: LogEntryId;
  foodId: FoodId;
  grams: number;
  units?: number;
  notes?: string;
  isBudgeted?: boolean;
}

/**
 * A one-time food estimate stored directly in the log. It is intentionally
 * not linked to, or persisted as, a reusable Food.
 */
export interface QuickAddEntry {
  type: "quick-add";
  id: LogEntryId;
  name: string;
  nutrition: NutritionValues;
  notes?: string;
  isBudgeted?: boolean;
}

/**
 * A visual separator/header in the daily log (e.g. "Breakfast", "Lunch").
 */
export interface SectionSeparator {
  type: "separator";
  id: LogEntryId;
  label: string;
}
export type DayLogItem = LogEntry | QuickAddEntry | SectionSeparator;

/**
 * All log items for a specific date within a profile.
 */
export interface DayLog {
  date: string;
  entries: DayLogItem[];
  weightKg?: number;
}

export type WeeklyMealPlan = Partial<Record<PlanWeekday, DayLogItem[]>>;

export type SaturatedFatMode = "grams" | "percentage";

export type Sex = "male" | "female";

export type ActivityLevel =
  | "sedentary"
  | "lightly_active"
  | "moderately_active"
  | "active"
  | "very_active";

/**
 * Body measurements and demographic data used to compute recommended nutrition
 * goals via Mifflin-St Jeor and related formulas.
 */
export interface UserMetrics {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
  targetWeightKg: number | null;
  /** Grams of protein per kg of body weight (default 1.8, range 1.6–2.2 for lifters). */
  proteinPerKg: number;
  /** Desired weight loss rate in kg/week (e.g. 0.5). Only used when targetWeightKg < weightKg. */
  weightLossRateKg: number;
}

/**
 * Daily nutrition targets for a profile.
 * When saturatedFatMode is "percentage", saturatedFat stores a percentage of
 * total calories (e.g. 10 means 10%). The gram budget is derived at display
 * time via: (calories * saturatedFat / 100) / 9.
 */
export interface NutritionGoals {
  calories: number;
  protein: number;
  saturatedFat: number;
  saturatedFatMode: SaturatedFatMode;
  fiber: number;
}

/**
 * Wake/sleep hours that define the "active day" window for budget calculation.
 * Hours are 0-23 in the user's local timezone.
 */
export interface WakeSleepSchedule {
  wakeHour: number;
  sleepHour: number;
}

/**
 * An active weight loss plan anchored to a start date and weight.
 * Expected weight for any date is computed linearly from the start.
 */
export interface WeightLossPlan {
  startDate: string;
  startWeightKg: number;
  targetWeightKg: number;
  weeklyLossRateKg: number;
}

/**
 * A tracking profile / "book" — an independent tracking context.
 */
export interface Profile {
  id: ProfileId;
  name: string;
  dayLogs: DayLog[];
  createdAt: string;
  goals: NutritionGoals | null;
  schedule: WakeSleepSchedule | null;
  userMetrics: UserMetrics | null;
  weightLossPlan: WeightLossPlan | null;
  weeklyPlan?: WeeklyMealPlan;
}

/**
 * The full application state stored in localStorage.
 */
export interface AppData {
  foods: Food[];
  profiles: Profile[];
  activeProfileId: ProfileId | null;
}
