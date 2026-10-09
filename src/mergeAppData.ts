import type {
  AppData,
  Food,
  FoodId,
  Profile,
  ProfileId,
  DayLog,
  DayLogItem,
  LogEntryId,
} from "./types.js";
import {
  buildDeletedDayLogEntrySet,
  deletedDayLogEntryKey,
  filterDeletedDayLogEntriesFromDayLog,
  filterDeletedDayLogEntriesFromDayLogs,
  mergeDeletedDayLogEntries,
} from "./deletedDayLogEntries.js";
import {
  filterDeletedAppEntitiesFromAppData,
  mergeDeletedFoods,
  mergeDeletedProfiles,
} from "./deletedAppEntities.js";

/**
 * Merges local and cloud AppData so that no live data is ever lost.
 * Mostly additive: items that exist in either source are kept unless an exact
 * deletion tombstone says that entry, food, or profile was intentionally removed.
 * For items with the same ID in both, cloud wins (most recently synced).
 */
export function mergeAppData(local: AppData, cloud: AppData): AppData {
  const deletedDayLogEntries = mergeDeletedDayLogEntries(
    local.deletedDayLogEntries ?? [],
    cloud.deletedDayLogEntries ?? [],
  );
  const deletedFoods = mergeDeletedFoods(
    local.deletedFoods ?? [],
    cloud.deletedFoods ?? [],
  );
  const deletedProfiles = mergeDeletedProfiles(
    local.deletedProfiles ?? [],
    cloud.deletedProfiles ?? [],
  );
  const deletedDayLogEntrySet = buildDeletedDayLogEntrySet(
    deletedDayLogEntries,
  );

  return filterDeletedAppEntitiesFromAppData({
    foods: mergeFoods(local.foods, cloud.foods),
    profiles: mergeProfiles(
      local.profiles,
      cloud.profiles,
      deletedDayLogEntrySet,
    ),
    activeProfileId: cloud.activeProfileId ?? local.activeProfileId,
    deletedDayLogEntries,
    deletedFoods,
    deletedProfiles,
  });
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
  deletedDayLogEntrySet: ReadonlySet<string>,
): Profile[] {
  const cloudMap = new Map<ProfileId, Profile>(
    cloudProfiles.map((p) => [p.id, p]),
  );

  const merged: Profile[] = cloudProfiles.map((cloudProfile) => {
    const localProfile = localProfiles.find((p) => p.id === cloudProfile.id);
    if (localProfile == null) {
      return {
        ...cloudProfile,
        dayLogs: filterDeletedDayLogEntriesFromDayLogs(
          cloudProfile.id,
          cloudProfile.dayLogs,
          deletedDayLogEntrySet,
        ),
      };
    }
    return {
      ...cloudProfile,
      userMetrics: cloudProfile.userMetrics ?? localProfile.userMetrics ?? null,
      weightLossPlan: cloudProfile.weightLossPlan ?? localProfile.weightLossPlan ?? null,
      mealPlans: cloudProfile.mealPlans ?? localProfile.mealPlans ?? [],
      weeklyPlan: cloudProfile.weeklyPlan ?? localProfile.weeklyPlan ?? {},
      dayLogs: mergeDayLogs(
        cloudProfile.id,
        localProfile.dayLogs,
        cloudProfile.dayLogs,
        deletedDayLogEntrySet,
      ),
    };
  });

  for (const localProfile of localProfiles) {
    if (!cloudMap.has(localProfile.id)) {
      merged.push({
        ...localProfile,
        dayLogs: filterDeletedDayLogEntriesFromDayLogs(
          localProfile.id,
          localProfile.dayLogs,
          deletedDayLogEntrySet,
        ),
      });
    }
  }

  return merged;
}

function mergeDayLogs(
  profileId: ProfileId,
  localLogs: ReadonlyArray<DayLog>,
  cloudLogs: ReadonlyArray<DayLog>,
  deletedDayLogEntrySet: ReadonlySet<string>,
): DayLog[] {
  const cloudMap = new Map<string, DayLog>(
    cloudLogs.map((dl) => [dl.date, dl]),
  );

  const merged: DayLog[] = cloudLogs.map((cloudLog) => {
    const localLog = localLogs.find((dl) => dl.date === cloudLog.date);
    if (localLog == null) {
      return filterDeletedDayLogEntriesFromDayLog(
        profileId,
        cloudLog,
        deletedDayLogEntrySet,
      );
    }
    return {
      ...cloudLog,
      weightKg: cloudLog.weightKg ?? localLog.weightKg,
      weightNotes: cloudLog.weightNotes ?? localLog.weightNotes,
      entries: mergeEntries(
        profileId,
        cloudLog.date,
        localLog.entries,
        cloudLog.entries,
        deletedDayLogEntrySet,
      ),
    };
  });

  for (const localLog of localLogs) {
    if (!cloudMap.has(localLog.date)) {
      merged.push(
        filterDeletedDayLogEntriesFromDayLog(
          profileId,
          localLog,
          deletedDayLogEntrySet,
        ),
      );
    }
  }

  return merged;
}

function mergeEntries(
  profileId: ProfileId,
  date: string,
  localEntries: ReadonlyArray<DayLogItem>,
  cloudEntries: ReadonlyArray<DayLogItem>,
  deletedDayLogEntrySet: ReadonlySet<string>,
): DayLogItem[] {
  const liveCloudEntries = cloudEntries.filter(
    (entry) =>
      !deletedDayLogEntrySet.has(
        deletedDayLogEntryKey(profileId, date, entry.id),
      ),
  );
  const cloudIds = new Set<LogEntryId>(liveCloudEntries.map((e) => e.id));
  const localOnly = localEntries.filter(
    (entry) =>
      !cloudIds.has(entry.id) &&
      !deletedDayLogEntrySet.has(
        deletedDayLogEntryKey(profileId, date, entry.id),
      ),
  );
  return [...liveCloudEntries, ...localOnly];
}

/** JSON with object keys sorted, so equal data always serializes equally. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v == null || typeof v !== "object" || Array.isArray(v)) return v;
    return Object.fromEntries(
      Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  });
}

export interface CloudPullPlan {
  merged: AppData;
  /** This device must adopt `merged`: the cloud had something it lacked. */
  localChanged: boolean;
  /** The cloud must receive `merged`: this device had something it lacked. */
  cloudChanged: boolean;
}

/**
 * What a pull of the cloud copy changes on each side. Equality is canonical,
 * because the app and Firestore order object keys differently and a pull that
 * changes nothing must not count as a change (it would wipe the undo history).
 */
export function planCloudPull(local: AppData, cloud: AppData): CloudPullPlan {
  const merged = mergeAppData(local, cloud);
  const mergedJson = canonicalJson(merged);
  return {
    merged,
    localChanged: mergedJson !== canonicalJson(local),
    cloudChanged: mergedJson !== canonicalJson(cloud),
  };
}
