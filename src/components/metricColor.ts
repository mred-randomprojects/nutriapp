/**
 * The one status of a Daily Totals metric against its budget so far today.
 * The number and the bar under it are both painted from this tone, so they
 * can never disagree.
 *
 * The meaning is the same for every metric:
 * - green ("good"): on plan.
 * - yellow ("warn"): about to drift off the plan, or slightly off it but
 *   within what a normal day allows.
 * - red ("bad"): definitely off the plan.
 *
 * What "on plan" means depends on the metric's kind (`ratio` = actual/budget):
 *
 * | kind                    | green        | yellow                  | red              |
 * |-------------------------|--------------|-------------------------|------------------|
 * | limit (kcal, sat fat)   | < 90%        | 90% to 100% + tolerance | > 100% + tolerance |
 * | minimum (protein)       | ≥ 100%       | 90% to 100%             | < 90%            |
 * | target (fiber)          | ≥ 100%       | < 100%                  | never            |
 *
 * kcal has a 20% tolerance (a few hundred kcal over is a normal day); sat fat
 * has none. Fiber is never red: falling short of it is not an alarm.
 */
export type MetricKind = "limit" | "minimum" | "target";
export type MetricTone = "good" | "warn" | "bad";

/** kcal stays yellow up to 20% over its budget (2500 → red above 3000). */
export const KCAL_OVER_TOLERANCE = 0.2;

/** How close to the budget (as a fraction of it) yellow starts warning. */
export const NEAR_BUDGET = 0.9;

export function metricTone(actual: number, budget: number, kind: MetricKind, overTolerance = 0): MetricTone {
  const ratio = actual / budget;
  switch (kind) {
    case "target":
      return ratio >= 1 ? "good" : "warn";
    case "minimum":
      if (ratio >= 1) return "good";
      return ratio >= NEAR_BUDGET ? "warn" : "bad";
    case "limit":
      if (ratio > 1 + overTolerance) return "bad";
      return ratio >= NEAR_BUDGET ? "warn" : "good";
  }
}
