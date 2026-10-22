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
  /** This account's sync state on this device (SyncMeta). */
  sync: string;
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
  const sync = `nutriapp-sync:${uid}`;
  if (owner === uid) return { uid, ...LEGACY_KEYS, sync };
  return {
    uid,
    data: `${LEGACY_KEYS.data}:${uid}`,
    backup: `${LEGACY_KEYS.backup}:${uid}`,
    corruptRecovery: `${LEGACY_KEYS.corruptRecovery}:${uid}`,
    sync,
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

/**
 * Reads a stored copy (this tab's own, or one another tab just wrote); null
 * when it is not valid JSON of the AppData shape.
 */
export function parseAppData(raw: string): AppData | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return normalizeAppData(parsed as AppData);
  } catch {
    return null;
  }
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
      return (backup == null ? null : parseAppData(backup)) ?? emptyAppData();
    } catch {
      return emptyAppData();
    }
  }

  const parsed = parseAppData(raw);
  if (parsed != null) return parsed;

  // Data exists but is corrupt — stash the raw string so it can be recovered
  // manually via devtools, then fall back to the backup if available.
  try {
    storage.setItem(keys.corruptRecovery, raw);
  } catch {
    // Best-effort; quota may be full.
  }
  try {
    const backup = storage.getItem(keys.backup);
    if (backup != null) return parseAppData(backup) ?? emptyAppData();
  } catch {
    // Backup unreadable too — nothing we can do.
  }
  return emptyAppData();
}

/**
 * Writes `data` as this account's local copy, keeping the previous one as a
 * backup. When the shared quota is full, the backup goes first: it doubles
 * this app's share, and the current copy matters more. Throws
 * StorageQuotaError when even the current copy does not fit.
 */
export function saveAppData(
  keys: LocalKeys,
  data: AppData,
  storage: Storage = localStorage,
): void {
  const json = JSON.stringify(data);
  const previous = storage.getItem(keys.data);
  // A copy that does not parse is what loadAppData fell back past: rolling it
  // into the backup slot would replace the only good copy with the bad one.
  if (previous != null && previous !== json && isRestorable(previous)) {
    try {
      storage.setItem(keys.backup, previous);
    } catch {
      // Best-effort; if quota is tight we still want the primary write to succeed.
    }
  }
  try {
    storage.setItem(keys.data, json);
  } catch (e: unknown) {
    if (!isQuotaError(e)) throw e;
    try {
      storage.removeItem(keys.backup);
    } catch {
      // Nothing to free.
    }
    safeSetItem(storage, keys.data, json);
  }
}

/**
 * What this device knows about its sync with the cloud, kept next to the data
 * so a reload or a relaunch does not forget it. Every tab of this account in
 * this browser shares it.
 */
export interface PendingMark {
  /** When the change was last edited (see syncEngine.ts compareStamps). */
  stamp: string;
  /**
   * A fingerprint of the version that must win (syncMerge.ts
   * changeFingerprint). The mark only counts for a copy holding exactly that
   * version: a copy that lags behind it (its write did not fit, or another
   * tab wrote over it) must not win with an older version.
   */
  print: string;
}

export interface SyncMeta {
  /**
   * The changes no cloud write has carried yet (see syncMerge.ts ChangeKey).
   * They win the next merge.
   */
  pending: Record<string, PendingMark>;
  /**
   * The first pull of the sync engine on this device has merged the local
   * copy the previous build left (see SyncEngine's upgrade fill). Absent in
   * a copy only the previous build wrote.
   */
  filled?: boolean;
}

export function loadSyncMeta(keys: LocalKeys, storage: Storage = localStorage): SyncMeta {
  let raw: string | null = null;
  try {
    raw = storage.getItem(keys.sync);
  } catch {
    return { pending: {} };
  }
  if (raw == null) return { pending: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object") return { pending: {} };
    const record = parsed as Record<string, unknown>;
    const pending: Record<string, PendingMark> = {};
    if (record.pending != null && typeof record.pending === "object") {
      for (const [change, mark] of Object.entries(record.pending as Record<string, unknown>)) {
        if (mark == null || typeof mark !== "object") continue;
        const { stamp, print } = mark as Record<string, unknown>;
        if (typeof stamp === "string" && typeof print === "string") pending[change] = { stamp, print };
      }
    }
    return record.filled === true ? { pending, filled: true } : { pending };
  } catch {
    return { pending: {} };
  }
}

/** Throws StorageQuotaError when the shared quota is full. */
export function saveSyncMeta(
  keys: LocalKeys,
  meta: SyncMeta,
  storage: Storage = localStorage,
): void {
  const json = JSON.stringify(meta);
  try {
    storage.setItem(keys.sync, json);
  } catch (e: unknown) {
    if (!isQuotaError(e)) throw e;
    // The marks are small and decide what wins at the next launch; the
    // backup is a whole second copy. Make room with it, as saveAppData does.
    try {
      storage.removeItem(keys.backup);
    } catch {
      // Nothing to free.
    }
    safeSetItem(storage, keys.sync, json);
  }
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
