import type { ActivityLevel, Sex, UserMetrics } from "./types";

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  lightly_active: 1.375,
  moderately_active: 1.55,
  active: 1.725,
  very_active: 1.9,
};

const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: "Sedentary (desk job, little exercise)",
  lightly_active: "Lightly active (1–3 days/week)",
  moderately_active: "Moderately active (3–5 days/week)",
  active: "Active (6–7 days/week)",
  very_active: "Very active (athlete / physical job)",
};

const ACTIVITY_LEVELS: ReadonlyArray<ActivityLevel> = [
  "sedentary",
  "lightly_active",
  "moderately_active",
  "active",
  "very_active",
];

/** Mifflin-St Jeor basal metabolic rate (kcal/day). */
function computeBmr(sex: Sex, weightKg: number, heightCm: number, age: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === "male" ? base + 5 : base - 161;
}

/** Total daily energy expenditure = BMR × activity multiplier. */
function computeTdee(sex: Sex, weightKg: number, heightCm: number, age: number, activityLevel: ActivityLevel): number {
  return computeBmr(sex, weightKg, heightCm, age) * ACTIVITY_MULTIPLIERS[activityLevel];
}

const SAT_FAT_PERCENTAGE = 10;
/** ~7700 kcal deficit ≈ 1 kg of body weight lost. */
const KCAL_PER_KG = 7700;

interface RecommendedGoals {
  calories: number;
  protein: number;
  saturatedFatPercentage: number;
  fiber: number;
}

function computeRecommendedGoals(metrics: UserMetrics): RecommendedGoals {
  const tdee = computeTdee(metrics.sex, metrics.weightKg, metrics.heightCm, metrics.age, metrics.activityLevel);
  const calories = Math.round(tdee);
  const protein = Math.round(metrics.weightKg * metrics.proteinPerKg);

  // Fiber: 14g per 1000 kcal, adjusted by sex.
  // Men under 50: 31–34g, women under 50: 25–28g.
  // We use 14g/1000kcal as the base, then clamp to sex-appropriate minimums.
  const fiberFromCalories = Math.round((calories / 1000) * 14);
  const fiberFloor = metrics.sex === "male" ? 28 : 22;
  const fiber = Math.max(fiberFromCalories, fiberFloor);

  return {
    calories,
    protein,
    saturatedFatPercentage: SAT_FAT_PERCENTAGE,
    fiber,
  };
}

interface DeficitInfo {
  dailyDeficit: number;
  deficitPercentage: number;
  weeklyWeightLossKg: number;
}

/**
 * Computes deficit info when the user's calorie goal is below their TDEE.
 * Returns null when there is no deficit (goal >= TDEE).
 */
function computeDeficitInfo(metrics: UserMetrics, calorieGoal: number): DeficitInfo | null {
  const tdee = computeTdee(metrics.sex, metrics.weightKg, metrics.heightCm, metrics.age, metrics.activityLevel);
  const dailyDeficit = tdee - calorieGoal;
  if (dailyDeficit <= 0) return null;

  return {
    dailyDeficit: Math.round(dailyDeficit),
    deficitPercentage: Math.round((dailyDeficit / tdee) * 100),
    weeklyWeightLossKg: (dailyDeficit * 7) / KCAL_PER_KG,
  };
}

interface WeightGoalEstimate {
  estimatedDays: number;
  estimatedDate: Date;
}

/**
 * Iterative week-by-week simulation: each week, recalculate BMR at the
 * current (decreasing) weight, recompute the deficit, and accumulate
 * weight loss. Stops when target is reached or deficit vanishes.
 */
function computeWeightGoalEstimate(
  metrics: UserMetrics,
  calorieGoal: number,
): WeightGoalEstimate | null {
  if (metrics.targetWeightKg == null) return null;
  const targetKg = metrics.targetWeightKg;
  if (targetKg >= metrics.weightKg) return null;

  let currentWeight = metrics.weightKg;
  let totalDays = 0;
  const maxWeeks = 520; // 10-year safety cap

  for (let week = 0; week < maxWeeks; week++) {
    const weeklyTdee = computeTdee(metrics.sex, currentWeight, metrics.heightCm, metrics.age, metrics.activityLevel);
    const dailyDeficit = weeklyTdee - calorieGoal;
    if (dailyDeficit <= 0) return null;

    const weeklyLoss = (dailyDeficit * 7) / KCAL_PER_KG;
    const newWeight = currentWeight - weeklyLoss;

    if (newWeight <= targetKg) {
      const remainingKg = currentWeight - targetKg;
      const remainingDays = Math.ceil((remainingKg * KCAL_PER_KG) / dailyDeficit);
      totalDays += remainingDays;
      break;
    }

    currentWeight = newWeight;
    totalDays += 7;
  }

  const estimatedDate = new Date();
  estimatedDate.setDate(estimatedDate.getDate() + totalDays);

  return { estimatedDays: totalDays, estimatedDate };
}

export {
  ACTIVITY_LABELS,
  ACTIVITY_LEVELS,
  ACTIVITY_MULTIPLIERS,
  computeBmr,
  computeDeficitInfo,
  computeRecommendedGoals,
  computeTdee,
  computeWeightGoalEstimate,
};
export type { DeficitInfo, RecommendedGoals, WeightGoalEstimate };
