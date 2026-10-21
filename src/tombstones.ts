import type {
  AppData,
  DeletedDayLogEntry,
  DeletedFood,
  DeletedProfile,
} from "./types.js";

/**
 * A deletion tombstone with an optional resurrection timestamp.
 * Shared shape across DeletedFood / DeletedProfile / DeletedDayLogEntry.
 */
export interface TombstoneTimes {
  deletedAt: string;
  restoredAt?: string;
}

/**
 * A tombstone marks its entity as deleted only when it has not been restored
 * more recently than it was deleted. ISO-8601 timestamps compare correctly as
 * strings, so a plain `>` is sufficient.
 */
export function isTombstoneActive(tombstone: TombstoneTimes): boolean {
  return tombstone.restoredAt == null || tombstone.deletedAt > tombstone.restoredAt;
}

/** Returns the later of two optional ISO timestamps (undefined-safe). */
export function maxTimestamp(
  a: string | undefined,
  b: string | undefined,
): string | undefined {
  if (a == null) return b;
  if (b == null) return a;
  return a > b ? a : b;
}

/**
 * Combines two tombstones that share the same key. Both `deletedAt` and
 * `restoredAt` merge by max independently, which makes the merge commutative
 * and associative — the property distributed sync relies on. Non-timestamp
 * identifying fields are taken from `a` (they are equal by construction).
 */
export function mergeTombstonePair<T extends TombstoneTimes>(a: T, b: T): T {
  const deletedAt = a.deletedAt > b.deletedAt ? a.deletedAt : b.deletedAt;
  const restoredAt = maxTimestamp(a.restoredAt, b.restoredAt);
  return { ...a, deletedAt, restoredAt };
}

/**
 * Reconciles the tombstones of one kind for a restore of `target` over
 * `current`. Whether an entity ends up deleted follows from `target`'s live
 * data, not from its tombstone list: an entity `target` holds must not be
 * deleted, and one it lacks must stay deleted. (Going by the list alone, an
 * undo back past an addition and its later deletion found no tombstone in
 * `target`, restored the deletion, and the entity, which `target` lacks, came
 * back from the cloud copy and every other device.) Where the result
 * disagrees with `current`, the flipping timestamp is stamped `now` so it
 * wins every later max-merge:
 *   - must stay deleted, but restored in `current` → bump `deletedAt` to now
 *   - must be live, but deleted in `current`      → bump `restoredAt` to now
 */
function reconcileTombstoneArray<T extends TombstoneTimes>(
  targetArr: ReadonlyArray<T>,
  currentArr: ReadonlyArray<T>,
  keyOf: (tombstone: T) => string,
  isLiveInTarget: (key: string) => boolean,
  now: string,
): T[] {
  const targetMap = new Map(targetArr.map((t) => [keyOf(t), t]));
  const currentMap = new Map(currentArr.map((t) => [keyOf(t), t]));
  const keys = new Set([...targetMap.keys(), ...currentMap.keys()]);

  const result: T[] = [];
  for (const key of keys) {
    const target = targetMap.get(key);
    const current = currentMap.get(key);
    // Both copies descend from one history, so merging by max loses nothing.
    const merged =
      target != null && current != null
        ? sameTimes(target, current)
          ? target
          : mergeTombstonePair(target, current)
        : ((target ?? current) as T);
    const live = isLiveInTarget(key);
    if (live && isTombstoneActive(merged)) {
      // Un-delete: keep the original deletedAt but restore more recently.
      result.push({ ...merged, restoredAt: now });
    } else if (!live && !isTombstoneActive(merged)) {
      // Re-delete: make deletedAt newer than any restoredAt.
      result.push({ ...merged, deletedAt: now });
    } else {
      result.push(withoutUndefinedRestore(merged));
    }
  }

  return result;
}

function sameTimes(a: TombstoneTimes, b: TombstoneTimes): boolean {
  return a.deletedAt === b.deletedAt && a.restoredAt === b.restoredAt;
}

function withoutUndefinedRestore<T extends TombstoneTimes>(tombstone: T): T {
  if (tombstone.restoredAt !== undefined || !("restoredAt" in tombstone)) return tombstone;
  const copy = { ...tombstone };
  delete copy.restoredAt;
  return copy;
}

/**
 * Adds `removals` over `arr`: a key both have is merged by max, so a removal
 * stamped `now` wins over an older restore.
 */
function withRemovals<T extends TombstoneTimes>(
  arr: ReadonlyArray<T>,
  removals: ReadonlyArray<T>,
  keyOf: (tombstone: T) => string,
): T[] {
  if (removals.length === 0) return [...arr];
  const byKey = new Map(arr.map((t) => [keyOf(t), t]));
  for (const removal of removals) {
    const key = keyOf(removal);
    const existing = byKey.get(key);
    byKey.set(key, existing == null ? removal : mergeTombstonePair(existing, removal));
  }
  return [...byKey.values()];
}

/**
 * Tombstones for what `current` has and `target` lacks. Restoring `target`
 * removes those, and without a tombstone any device that already has them
 * keeps them as its own and pushes them back. Entries of a removed profile
 * need none: the profile's tombstone covers them.
 */
function removalTombstones(target: AppData, current: AppData, now: string) {
  const targetFoods = new Set(target.foods.map((f) => f.id));
  const targetProfiles = new Map(target.profiles.map((p) => [p.id, p]));

  const foods: DeletedFood[] = current.foods
    .filter((f) => !targetFoods.has(f.id))
    .map((f) => ({ foodId: f.id, deletedAt: now }));
  const profiles: DeletedProfile[] = [];
  const entries: DeletedDayLogEntry[] = [];

  for (const profile of current.profiles) {
    const targetProfile = targetProfiles.get(profile.id);
    if (targetProfile == null) {
      profiles.push({ profileId: profile.id, deletedAt: now });
      continue;
    }
    const targetEntries = new Set<string>();
    for (const day of targetProfile.dayLogs) {
      for (const entry of day.entries) targetEntries.add(`${day.date}\u0000${entry.id}`);
    }
    for (const day of profile.dayLogs) {
      for (const entry of day.entries) {
        if (targetEntries.has(`${day.date}\u0000${entry.id}`)) continue;
        entries.push({ profileId: profile.id, date: day.date, entryId: entry.id, deletedAt: now });
      }
    }
  }
  return { foods, profiles, entries };
}

const foodKey = (t: DeletedFood) => t.foodId;
const profileKey = (t: DeletedProfile) => t.profileId;
const entryKey = (t: DeletedDayLogEntry) =>
  `${t.profileId}\u0000${t.date}\u0000${t.entryId}`;

/** The keys of everything `data` holds live, in the tombstones' key format. */
function liveKeys(data: AppData) {
  const foods = new Set<string>(data.foods.map((f) => f.id));
  const profiles = new Set<string>(data.profiles.map((p) => p.id));
  const entries = new Set<string>();
  for (const profile of data.profiles) {
    for (const day of profile.dayLogs) {
      for (const entry of day.entries) {
        entries.add(`${profile.id}\u0000${day.date}\u0000${entry.id}`);
      }
    }
  }
  return { foods, profiles, entries };
}

/**
 * Produces the AppData to persist when restoring `target` (an earlier snapshot)
 * over the live `current` state. Live entities come straight from `target`;
 * only the tombstone arrays are reconciled, so that the restore survives the
 * next cloud merge: a deletion it undoes is not silently re-applied, and what
 * it removes (an undone addition) gets a fresh tombstone, or keeps its
 * existing one, instead of coming back from a device that already had it.
 */
export function reconcileTombstonesForRestore(
  target: AppData,
  current: AppData,
  now: string,
): AppData {
  const removed = removalTombstones(target, current, now);
  const live = liveKeys(target);
  return {
    ...target,
    deletedFoods: withRemovals(
      reconcileTombstoneArray(
        target.deletedFoods ?? [],
        current.deletedFoods ?? [],
        foodKey,
        (key) => live.foods.has(key),
        now,
      ),
      removed.foods,
      foodKey,
    ),
    deletedProfiles: withRemovals(
      reconcileTombstoneArray(
        target.deletedProfiles ?? [],
        current.deletedProfiles ?? [],
        profileKey,
        (key) => live.profiles.has(key),
        now,
      ),
      removed.profiles,
      profileKey,
    ),
    deletedDayLogEntries: withRemovals(
      reconcileTombstoneArray(
        target.deletedDayLogEntries ?? [],
        current.deletedDayLogEntries ?? [],
        entryKey,
        (key) => live.entries.has(key),
        now,
      ),
      removed.entries,
      entryKey,
    ),
  };
}
