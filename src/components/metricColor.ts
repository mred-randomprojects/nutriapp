/**
 * Colors of a Daily Totals metric against its budget.
 *
 * - "limit" (kcal, sat fat): staying under is good. Past the budget it is red,
 *   unless `overTolerance` allows some slack: kcal goes yellow from 100% to
 *   120% of the budget and red only beyond that, since a few hundred kcal over
 *   is a normal day, not an alarm.
 * - "minimum" (protein): reaching the budget is good, falling short is red.
 * - "target" (fiber): reaching it is green, short of it is yellow.
 */
export type MetricKind = "limit" | "minimum" | "target";
export type MetricTone = "good" | "warn" | "bad" | "neutral";

/** kcal stays yellow up to 20% over its budget (2500 → red above 3000). */
export const KCAL_OVER_TOLERANCE = 0.2;

/** Tone of the progress bar under the number. */
export function budgetBarTone(actual: number, budget: number, kind: MetricKind, overTolerance = 0): MetricTone {
  const ratio = actual / budget;
  if (kind === "target") return ratio >= 1 ? "good" : "warn";
  if (kind === "minimum") {
    if (ratio > 1) return "good";
    if (ratio >= 0.9) return "warn";
    return "bad";
  }
  if (ratio > 1 + overTolerance) return "bad";
  if (ratio >= 0.9) return "warn";
  return "good";
}

/** Tone of the number itself; "neutral" keeps its default color. */
export function metricNumberTone(actual: number, budget: number | null, kind: MetricKind, overTolerance = 0): MetricTone {
  if (budget == null || budget <= 0) return "neutral";
  const over = actual > budget;
  const under = actual < budget;
  if (kind === "target") return under ? "warn" : over ? "good" : "neutral";
  if (kind === "minimum") return under ? "bad" : over ? "good" : "neutral";
  if (actual > budget * (1 + overTolerance)) return "bad";
  return over ? "warn" : "neutral";
}
