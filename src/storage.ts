import type { AppData, ProfileId } from "./types.js";
import { filterDeletedAppEntitiesFromAppData } from "./deletedAppEntities.js";
import {
  isNutriAppKey,
  isQuotaError,
  storageSpaceMessage,
  storageUsage,
} from "./storageQuota.js";

/**
 * The uid the unsuffixed keys (`nutriapp-data`, its backup and its corrupt
 * copy) belong to. Before it existed, a browser kept one copy for whoever was
 * signed in, and the next account to sign in merged it into its own cloud
 * copy. The first account to load claims them (a device that used the app
 * was already signed in as their owner); any other account keeps its own
 * copy under keys suffixed with its uid. The two never read each other's.
 */
export const LOCAL_OWNER_KEY = "nutriapp-data-owner";

/** Where one account's local copy lives in this browser. */
export interface LocalKeys {
  uid: string;
  data: string;
  backup: string;
  corruptRecovery: string;
}

const LEGACY_KEYS = {
  data: "nutriapp-data",
  backup: "nutriapp-data-backup",
  corruptRecovery: "nutriapp-data-corrupt-recovery",
};

/**
 * The keys of `uid`'s local copy, claiming the unsuffixed ones if nobody owns
 * them yet. Leaves every other key alone: another account's copy stays where
 * it is, set aside for when it signs in again.
 */
export function localKeysFor(uid: string, storage: Storage = localStorage): LocalKeys {
  let owner: string | null = null;
  try {
    owner = storage.getItem(LOCAL_OWNER_KEY);
    if (owner == null) {
      storage.setItem(LOCAL_OWNER_KEY, uid);
      owner = uid;
    }
  } catch {
    // Storage blocked or full: nothing persists this session anyway.
    owner ??= uid;
  }
  if (owner === uid) return { uid, ...LEGACY_KEYS };
  return {
    uid,
    data: `${LEGACY_KEYS.data}:${uid}`,
    backup: `${LEGACY_KEYS.backup}:${uid}`,
    corruptRecovery: `${LEGACY_KEYS.corruptRecovery}:${uid}`,
  };
}

export class StorageQuotaError extends Error {
  constructor() {
    // The quota is the whole site's, so say whose bytes fill it.
    super(storageSpaceMessage(storageUsage(isNutriAppKey), "full"));
    this.name = "StorageQuotaError";
  }
}

function safeSetItem(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch (e: unknown) {
    if (isQuotaError(e)) {
      throw new StorageQuotaError();
    }
    throw e;
  }
}

export function emptyAppData(): AppData {
  return {
    foods: [],
    profiles: [],
    activeProfileId: null,
    deletedDayLogEntries: [],
    deletedFoods: [],
    deletedProfiles: [],
  };
}

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

/** Whether a stored copy is worth keeping as the backup: a JSON object. */
function isRestorable(raw: string): boolean {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed != null && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

export function loadAppData(keys: LocalKeys, storage: Storage = localStorage): AppData {
  let raw: string | null;
  try {
    raw = storage.getItem(keys.data);
  } catch {
    // Storage blocked (privacy settings): run on the cloud copy alone.
    return emptyAppData();
  }
  if (raw == null) {
    // No copy at all is a first visit, or something else on the shared
    // origin removed it (devtools, a cleaner, a sibling app). Then the backup
    // is the newest copy there is; starting empty would let the second save
    // roll the empty copy over it.
    try {
      const backup = storage.getItem(keys.backup);
      return backup == null ? emptyAppData() : normalizeAppData(JSON.parse(backup) as AppData);
    } catch {
      return emptyAppData();
    }
  }

  try {
    const parsed = JSON.parse(raw) as AppData;
    return normalizeAppData(parsed);
  } catch {
    // Data exists but is corrupt — stash the raw string so it can be recovered
    // manually via devtools, then fall back to the backup if available.
    try {
      storage.setItem(keys.corruptRecovery, raw);
    } catch {
      // Best-effort; quota may be full.
    }

    try {
      const backup = storage.getItem(keys.backup);
      if (backup != null) {
        const parsed = JSON.parse(backup) as AppData;
        return normalizeAppData(parsed);
      }
    } catch {
      // Backup also corrupt — nothing we can do.
    }

    return emptyAppData();
  }
}

export function saveAppData(
  keys: LocalKeys,
  data: AppData,
  storage: Storage = localStorage,
): void {
  const previous = storage.getItem(keys.data);
  // A copy that does not parse is what loadAppData fell back past: rolling it
  // into the backup slot would replace the only good copy with the bad one.
  if (previous != null && isRestorable(previous)) {
    try {
      storage.setItem(keys.backup, previous);
    } catch {
      // Best-effort; if quota is tight we still want the primary write to succeed.
    }
  }
  safeSetItem(storage, keys.data, JSON.stringify(data));
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
