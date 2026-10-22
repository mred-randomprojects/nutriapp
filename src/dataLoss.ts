import type { AppData, SavedMealPlan } from "./types.js";
import { mergeAppData } from "./mergeAppData.js";
import { reconcileTombstonesForRestore } from "./tombstones.js";

/**
 * What a merge took away from this device's data, by name where the app
 * shows one. Only removals count: a value the merge changed is an edit from
 * somewhere else, not a loss.
 */
export interface DataLoss {
  profiles: string[];
  foods: string[];
  /** Log entries (food, quick-add or section) that are gone. */
  entries: number;
  /** Days whose weight is gone. */
  weights: number;
  mealPlans: string[];
}

function entryKeys(data: AppData): Set<string> {
  const keys = new Set<string>();
  for (const profile of data.profiles) {
    for (const day of profile.dayLogs) {
      for (const entry of day.entries) keys.add(JSON.stringify([profile.id, day.date, entry.id]));
    }
  }
  return keys;
}

function weightKeys(data: AppData): Set<string> {
  const keys = new Set<string>();
  for (const profile of data.profiles) {
    for (const day of profile.dayLogs) {
      if (day.weightKg != null) keys.add(JSON.stringify([profile.id, day.date]));
    }
  }
  return keys;
}

function plans(data: AppData): Map<string, SavedMealPlan> {
  const result = new Map<string, SavedMealPlan>();
  for (const profile of data.profiles) {
    for (const plan of profile.mealPlans ?? []) result.set(JSON.stringify([profile.id, plan.id]), plan);
  }
  return result;
}

/**
 * What `after` lacks that `before` had, or null when it lacks nothing. Run on
 * every merge the cloud imposes on this device: a delete on another device,
 * an old build's whole-document write, or a bad write shows up here before
 * it replaces the only copy this device has.
 */
export function detectDataLoss(before: AppData, after: AppData): DataLoss | null {
  const afterProfiles = new Set<string>(after.profiles.map((p) => p.id));
  const afterFoods = new Set<string>(after.foods.map((f) => f.id));
  const afterEntries = entryKeys(after);
  const afterWeights = weightKeys(after);
  const afterPlans = plans(after);

  const loss: DataLoss = {
    profiles: before.profiles.filter((p) => !afterProfiles.has(p.id)).map((p) => p.name),
    foods: before.foods.filter((f) => !afterFoods.has(f.id)).map((f) => f.name),
    entries: [...entryKeys(before)].filter((k) => !afterEntries.has(k)).length,
    weights: [...weightKeys(before)].filter((k) => !afterWeights.has(k)).length,
    mealPlans: [...plans(before)].filter(([k]) => !afterPlans.has(k)).map(([, plan]) => plan.name),
  };
  const lost =
    loss.profiles.length > 0 ||
    loss.foods.length > 0 ||
    loss.entries > 0 ||
    loss.weights > 0 ||
    loss.mealPlans.length > 0;
  return lost ? loss : null;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function named(names: string[], one: string, many: string): string {
  return `${plural(names.length, one, many)} (${names.join(", ")})`;
}

/** "1 profile (Max), 2 log entries and 1 meal plan (Cut)". */
export function describeDataLoss(loss: DataLoss): string {
  const parts: string[] = [];
  if (loss.profiles.length > 0) parts.push(named(loss.profiles, "profile", "profiles"));
  if (loss.foods.length > 0) parts.push(named(loss.foods, "food", "foods"));
  if (loss.entries > 0) parts.push(plural(loss.entries, "log entry", "log entries"));
  if (loss.weights > 0) parts.push(plural(loss.weights, "weight", "weights"));
  if (loss.mealPlans.length > 0) parts.push(named(loss.mealPlans, "meal plan", "meal plans"));
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function withoutTombstones(data: AppData): AppData {
  return { ...data, deletedDayLogEntries: [], deletedFoods: [], deletedProfiles: [] };
}

/**
 * `current` plus everything `copy` has that `current` lacks: profiles, foods,
 * entries, days, weights and meal plans, deleted or not. What both have keeps
 * `current`'s version. The tombstones of what comes back are marked restored
 * (stamped `now`), so every other device brings it back too.
 */
export function restoreMissing(current: AppData, copy: AppData, now: string): AppData {
  // `current` plays the cloud: it wins every id both have, and a value it
  // lacks (a day's weight, a weight plan) is filled in from the copy.
  const union = mergeAppData(withoutTombstones(copy), withoutTombstones(current));
  const copyProfiles = new Map(copy.profiles.map((p) => [p.id, p]));
  const profiles = union.profiles.map((profile) => {
    const copied = copyProfiles.get(profile.id)?.mealPlans ?? [];
    const own = profile.mealPlans ?? [];
    const ids = new Set(own.map((p) => p.id));
    const missing = copied.filter((p) => !ids.has(p.id));
    return missing.length === 0 ? profile : { ...profile, mealPlans: [...own, ...missing] };
  });
  return reconcileTombstonesForRestore(
    {
      ...union,
      profiles,
      deletedDayLogEntries: current.deletedDayLogEntries,
      deletedFoods: current.deletedFoods,
      deletedProfiles: current.deletedProfiles,
    },
    current,
    now,
  );
}

/** This device's data from right before a merge took something away. */
export interface SafetyCopy {
  savedAt: string;
  data: AppData;
}

/**
 * The safety copy to keep after a merge turned `before` into `after`, or
 * null when the merge took nothing away (keep whatever copy there is).
 *
 * A copy already kept is never dropped for a newer one: the new copy holds
 * both, `before` plus whatever only the old copy has, so a second loss
 * before the first was dealt with does not lose the first.
 */
export function safetyCopyAfterMerge(
  existing: SafetyCopy | null,
  before: AppData,
  after: AppData,
  now: string,
): SafetyCopy | null {
  if (detectDataLoss(before, after) == null) return null;
  if (existing == null) return { savedAt: now, data: before };
  return { savedAt: now, data: restoreMissing(before, existing.data, now) };
}
