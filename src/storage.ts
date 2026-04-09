import type { AppData, ProfileId } from "./types";

const STORAGE_KEY = "nutriapp-data";

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
};

export function loadAppData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return { ...DEFAULT_APP_DATA };
    const parsed = JSON.parse(raw) as AppData;
    return {
      foods: parsed.foods ?? [],
      profiles: parsed.profiles ?? [],
      activeProfileId: parsed.activeProfileId ?? null,
    };
  } catch {
    return { ...DEFAULT_APP_DATA };
  }
}

export function saveAppData(data: AppData): void {
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
