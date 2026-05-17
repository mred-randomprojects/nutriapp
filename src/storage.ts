import type { AppData, ProfileId } from "./types";
import { filterDeletedAppEntitiesFromAppData } from "./deletedAppEntities";

const STORAGE_KEY = "nutriapp-data";
const BACKUP_KEY = "nutriapp-data-backup";
const CORRUPT_RECOVERY_KEY = "nutriapp-data-corrupt-recovery";

export class StorageQuotaError extends Error {
  constructor() {
    super(
      "localStorage is full — no space left to save your data. Consider exporting and deleting old profiles.",
    );
    this.name = "StorageQuotaError";
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (e: unknown) {
    if (
      e instanceof DOMException &&
      (e.name === "QuotaExceededError" ||
        e.name === "NS_ERROR_DOM_QUOTA_REACHED")
    ) {
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

export function getStorageUsage(): { usedBytes: number; quotaBytes: number } {
  let usedBytes = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key == null) continue;
    usedBytes += (key.length + (localStorage.getItem(key)?.length ?? 0)) * 2;
  }
  const quotaBytes = 5 * 1024 * 1024;
  return { usedBytes, quotaBytes };
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
