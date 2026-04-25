import type {
  AppData,
  Food,
  FoodId,
  Profile,
  ProfileId,
  DayLog,
  DayLogItem,
  LogEntryId,
} from "./types";

/**
 * Merges local and cloud AppData so that no data is ever lost.
 * Purely additive: items that exist in either source are kept.
 * For items with the same ID in both, cloud wins (most recently synced).
 */
export function mergeAppData(local: AppData, cloud: AppData): AppData {
  return {
    foods: mergeFoods(local.foods, cloud.foods),
    profiles: mergeProfiles(local.profiles, cloud.profiles),
    activeProfileId: cloud.activeProfileId ?? local.activeProfileId,
  };
}

function mergeFoods(
  localFoods: ReadonlyArray<Food>,
  cloudFoods: ReadonlyArray<Food>,
): Food[] {
  const cloudIds = new Set<FoodId>(cloudFoods.map((f) => f.id));
  const localOnly = localFoods.filter((f) => !cloudIds.has(f.id));
  return [...cloudFoods, ...localOnly];
}

function mergeProfiles(
  localProfiles: ReadonlyArray<Profile>,
  cloudProfiles: ReadonlyArray<Profile>,
): Profile[] {
  const cloudMap = new Map<ProfileId, Profile>(
    cloudProfiles.map((p) => [p.id, p]),
  );

  const merged: Profile[] = cloudProfiles.map((cloudProfile) => {
    const localProfile = localProfiles.find((p) => p.id === cloudProfile.id);
    if (localProfile == null) return cloudProfile;
    return {
      ...cloudProfile,
      userMetrics: cloudProfile.userMetrics ?? localProfile.userMetrics ?? null,
      weightLossPlan: cloudProfile.weightLossPlan ?? localProfile.weightLossPlan ?? null,
      mealPlans: cloudProfile.mealPlans ?? localProfile.mealPlans ?? [],
      weeklyPlan: cloudProfile.weeklyPlan ?? localProfile.weeklyPlan ?? {},
      dayLogs: mergeDayLogs(localProfile.dayLogs, cloudProfile.dayLogs),
    };
  });

  for (const localProfile of localProfiles) {
    if (!cloudMap.has(localProfile.id)) {
      merged.push(localProfile);
    }
  }

  return merged;
}

function mergeDayLogs(
  localLogs: ReadonlyArray<DayLog>,
  cloudLogs: ReadonlyArray<DayLog>,
): DayLog[] {
  const cloudMap = new Map<string, DayLog>(
    cloudLogs.map((dl) => [dl.date, dl]),
  );

  const merged: DayLog[] = cloudLogs.map((cloudLog) => {
    const localLog = localLogs.find((dl) => dl.date === cloudLog.date);
    if (localLog == null) return cloudLog;
    return {
      ...cloudLog,
      weightKg: cloudLog.weightKg ?? localLog.weightKg,
      entries: mergeEntries(localLog.entries, cloudLog.entries),
    };
  });

  for (const localLog of localLogs) {
    if (!cloudMap.has(localLog.date)) {
      merged.push(localLog);
    }
  }

  return merged;
}

function mergeEntries(
  localEntries: ReadonlyArray<DayLogItem>,
  cloudEntries: ReadonlyArray<DayLogItem>,
): DayLogItem[] {
  const cloudIds = new Set<LogEntryId>(cloudEntries.map((e) => e.id));
  const localOnly = localEntries.filter((e) => !cloudIds.has(e.id));
  return [...cloudEntries, ...localOnly];
}
