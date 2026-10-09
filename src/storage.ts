import type { AppData, ProfileId } from "./types";
import { filterDeletedAppEntitiesFromAppData } from "./deletedAppEntities";
import {
  isNutriAppKey,
  isQuotaError,
  storageSpaceMessage,
  storageUsage,
} from "./storageQuota";

const STORAGE_KEY = "nutriapp-data";
const BACKUP_KEY = "nutriapp-data-backup";
const CORRUPT_RECOVERY_KEY = "nutriapp-data-corrupt-recovery";

export class StorageQuotaError extends Error {
  constructor() {
    // The quota is the whole site's, so say whose bytes fill it.
    super(storageSpaceMessage(storageUsage(isNutriAppKey), "full"));
    this.name = "StorageQuotaError";
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (e: unknown) {
    if (isQuotaError(e)) {
      throw new StorageQuotaError();
    }
    throw e;
  }
}

const DEFAULT_APP_DATA: AppData = {
  foods: [],
  profiles: [],
  activeProfileId: null,
  deletedDayLogEntries: [],
  deletedFoods: [],
  deletedProfiles: [],
};

function normalizeAppData(data: AppData): AppData {
  return filterDeletedAppEntitiesFromAppData({
    foods: data.foods ?? [],
    profiles: data.profiles ?? [],
    activeProfileId: data.activeProfileId ?? null,
    deletedDayLogEntries: data.deletedDayLogEntries ?? [],
    deletedFoods: data.deletedFoods ?? [],
    deletedProfiles: data.deletedProfiles ?? [],
  });
}

export function loadAppData(): AppData {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw == null) return { ...DEFAULT_APP_DATA };

  try {
    const parsed = JSON.parse(raw) as AppData;
    return normalizeAppData(parsed);
  } catch {
    // Data exists but is corrupt — stash the raw string so it can be recovered
    // manually via devtools, then fall back to the backup if available.
    try {
      localStorage.setItem(CORRUPT_RECOVERY_KEY, raw);
    } catch {
      // Best-effort; quota may be full.
    }

    const backup = localStorage.getItem(BACKUP_KEY);
    if (backup != null) {
      try {
        const parsed = JSON.parse(backup) as AppData;
        return normalizeAppData(parsed);
      } catch {
        // Backup also corrupt — nothing we can do.
      }
    }

    return { ...DEFAULT_APP_DATA };
  }
}

export function saveAppData(data: AppData): void {
  const previous = localStorage.getItem(STORAGE_KEY);
  if (previous != null) {
    try {
      localStorage.setItem(BACKUP_KEY, previous);
    } catch {
      // Best-effort; if quota is tight we still want the primary write to succeed.
    }
  }
  safeSetItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * Returns the DayLog for a given date in a profile, or undefined if none.
 */
export function findDayLog(
  data: AppData,
  profileId: ProfileId,
  date: string,
) {
  const profile = data.profiles.find((p) => p.id === profileId);
  if (profile == null) return undefined;
  return profile.dayLogs.find((d) => d.date === date);
}
