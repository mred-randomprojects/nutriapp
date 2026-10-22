import type { AppData, DayLog, Food, Profile, SavedMealPlan } from "./types.js";
import { mergeAppData } from "./mergeAppData.js";
import {
  filterDeletedAppEntitiesFromAppData,
  mergeDeletedFoods,
  mergeDeletedProfiles,
} from "./deletedAppEntities.js";
import { mergeDeletedDayLogEntries } from "./deletedDayLogEntries.js";

/**
 * Names one thing this device changed: a food, a profile (whether it exists),
 * one field of a profile, a day (whether it exists), one field of a day, the
 * order of a day's entries, one entry, or the active profile. A change is
 * "pending" from the moment it is made until a cloud write that carries it
 * succeeds; while pending, this device's version of it wins every merge.
 * Keys are JSON tuples, so no id can make two of them collide.
 */
export type ChangeKey = string;

const key = (...parts: string[]): ChangeKey => JSON.stringify(parts);

export const foodChange = (foodId: string) => key("food", foodId);
export const profileChange = (profileId: string) => key("profile", profileId);
export const profileFieldChange = (profileId: string, field: string) =>
  key("profileField", profileId, field);
export const dayChange = (profileId: string, date: string) => key("day", profileId, date);
export const dayFieldChange = (profileId: string, date: string, field: string) =>
  key("dayField", profileId, date, field);
export const dayOrderChange = (profileId: string, date: string) =>
  key("dayOrder", profileId, date);
export const entryChange = (profileId: string, date: string, entryId: string) =>
  key("entry", profileId, date, entryId);
/** One saved meal plan: a list of them merges plan by plan, like entries. */
export const planChange = (profileId: string, planId: string) => key("plan", profileId, planId);
export const planOrderChange = (profileId: string) => key("planOrder", profileId);
export const ACTIVE_PROFILE_CHANGE = key("activeProfile");

/** Structural equality with JSON semantics: key order and undefined fields don't count. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (a == null || b == null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  const recordA = a as Record<string, unknown>;
  const recordB = b as Record<string, unknown>;
  const keysA = Object.keys(recordA).filter((k) => recordA[k] !== undefined);
  const keysB = Object.keys(recordB).filter((k) => recordB[k] !== undefined);
  return (
    keysA.length === keysB.length &&
    keysA.every((k) => recordB[k] !== undefined && deepEqual(recordA[k], recordB[k]))
  );
}

function byId<T extends { id: string }>(items: ReadonlyArray<T>): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function byDate(days: ReadonlyArray<DayLog>): Map<string, DayLog> {
  return new Map(days.map((day) => [day.date, day]));
}

function fieldNames(a: object, b: object, skip: ReadonlyArray<string>): Set<string> {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const name of skip) names.delete(name);
  return names;
}

function field(record: object, name: string): unknown {
  return (record as Record<string, unknown>)[name];
}

/** The ids of `entries` that `other` also has, in `entries`' order. */
function commonOrder(entries: ReadonlyArray<{ id: string }>, other: ReadonlySet<string>): string[] {
  return entries.filter((entry) => other.has(entry.id)).map((entry) => entry.id);
}

function diffDays(
  profileId: string,
  prev: ReadonlyArray<DayLog>,
  next: ReadonlyArray<DayLog>,
  changes: Set<ChangeKey>,
): void {
  const prevDays = byDate(prev);
  const nextDays = byDate(next);
  for (const date of new Set([...prevDays.keys(), ...nextDays.keys()])) {
    const a = prevDays.get(date);
    const b = nextDays.get(date);
    if (a === b) continue;
    if (a == null || b == null) {
      changes.add(dayChange(profileId, date));
      if (b != null) {
        // A day added here: the cloud may have the same date from another
        // device, so its weight and entries must win over that one too.
        for (const name of fieldNames(b, b, ["date", "entries"])) {
          changes.add(dayFieldChange(profileId, date, name));
        }
        for (const entry of b.entries) changes.add(entryChange(profileId, date, entry.id));
      } else if (a != null) {
        // A day removed here (an undo): its weight goes with it. Named
        // field by field, so that once a merge has kept the day as an empty
        // shell (see overlayProfile), the shell's missing weight still wins
        // over the cloud's.
        for (const name of fieldNames(a, a, ["date", "entries"])) {
          changes.add(dayFieldChange(profileId, date, name));
        }
      }
      continue;
    }
    for (const name of fieldNames(a, b, ["date", "entries"])) {
      if (!deepEqual(field(a, name), field(b, name))) {
        changes.add(dayFieldChange(profileId, date, name));
      }
    }
    if (a.entries === b.entries) continue;
    const prevEntries = byId(a.entries);
    const nextEntries = byId(b.entries);
    for (const id of new Set([...prevEntries.keys(), ...nextEntries.keys()])) {
      const ea = prevEntries.get(id);
      const eb = nextEntries.get(id);
      if (ea !== eb && !deepEqual(ea, eb)) changes.add(entryChange(profileId, date, id));
    }
    const prevOrder = commonOrder(a.entries, new Set(nextEntries.keys()));
    const nextOrder = commonOrder(b.entries, new Set(prevEntries.keys()));
    if (!deepEqual(prevOrder, nextOrder)) changes.add(dayOrderChange(profileId, date));
  }
}

/**
 * A profile's meal plans change plan by plan: a list replaced as a whole
 * would drop a plan another device added, or bring back one it deleted,
 * whenever this device edited a different plan before pulling.
 */
function diffPlans(
  profileId: string,
  prev: ReadonlyArray<SavedMealPlan>,
  next: ReadonlyArray<SavedMealPlan>,
  changes: Set<ChangeKey>,
): void {
  const prevPlans = byId(prev);
  const nextPlans = byId(next);
  for (const id of new Set([...prevPlans.keys(), ...nextPlans.keys()])) {
    const a = prevPlans.get(id);
    const b = nextPlans.get(id);
    if (a !== b && !deepEqual(a, b)) changes.add(planChange(profileId, id));
  }
  const prevOrder = commonOrder(prev, new Set(nextPlans.keys()));
  const nextOrder = commonOrder(next, new Set(prevPlans.keys()));
  if (!deepEqual(prevOrder, nextOrder)) changes.add(planOrderChange(profileId));
}

/**
 * What changed from `prev` to `next`, as change keys. Cheap for the usual
 * edit: thanks to the immutable updates, untouched records keep their
 * identity and are skipped without a deep comparison.
 */
export function changedKeys(prev: AppData, next: AppData): Set<ChangeKey> {
  const changes = new Set<ChangeKey>();

  if (prev.foods !== next.foods) {
    const prevFoods = byId(prev.foods);
    const nextFoods = byId(next.foods);
    for (const id of new Set([...prevFoods.keys(), ...nextFoods.keys()])) {
      const a = prevFoods.get(id);
      const b = nextFoods.get(id);
      if (a !== b && !deepEqual(a, b)) changes.add(foodChange(id));
    }
  }

  if (prev.profiles !== next.profiles) {
    const prevProfiles = byId(prev.profiles);
    const nextProfiles = byId(next.profiles);
    for (const id of new Set([...prevProfiles.keys(), ...nextProfiles.keys()])) {
      const a = prevProfiles.get(id);
      const b = nextProfiles.get(id);
      if (a === b) continue;
      if (a == null || b == null) {
        changes.add(profileChange(id));
        continue;
      }
      for (const name of fieldNames(a, b, ["id", "dayLogs", "mealPlans"])) {
        if (!deepEqual(field(a, name), field(b, name))) {
          changes.add(profileFieldChange(id, name));
        }
      }
      if (a.mealPlans !== b.mealPlans) diffPlans(id, a.mealPlans ?? [], b.mealPlans ?? [], changes);
      if (a.dayLogs !== b.dayLogs) diffDays(id, a.dayLogs, b.dayLogs, changes);
    }
  }

  if (prev.activeProfileId !== next.activeProfileId) changes.add(ACTIVE_PROFILE_CHANGE);
  return changes;
}

interface DayPlan {
  exists: boolean;
  fields: Set<string>;
  order: boolean;
  entries: Set<string>;
}

interface ProfilePlan {
  exists: boolean;
  fields: Set<string>;
  days: Map<string, DayPlan>;
  mealPlans: Set<string>;
  mealPlanOrder: boolean;
}

interface OverlayPlan {
  foods: Set<string>;
  profiles: Map<string, ProfilePlan>;
  activeProfile: boolean;
}

function planOverlay(changes: Iterable<ChangeKey>): OverlayPlan {
  const plan: OverlayPlan = { foods: new Set(), profiles: new Map(), activeProfile: false };
  const profilePlan = (id: string) => {
    let p = plan.profiles.get(id);
    if (p == null) {
      p = { exists: false, fields: new Set(), days: new Map(), mealPlans: new Set(), mealPlanOrder: false };
      plan.profiles.set(id, p);
    }
    return p;
  };
  const dayPlan = (profileId: string, date: string) => {
    const p = profilePlan(profileId);
    let d = p.days.get(date);
    if (d == null) {
      d = { exists: false, fields: new Set(), order: false, entries: new Set() };
      p.days.set(date, d);
    }
    return d;
  };

  for (const change of changes) {
    const parts = parseChange(change);
    if (parts == null) continue;
    const [kind, a, b, c] = parts;
    switch (kind) {
      case "food":
        if (a != null) plan.foods.add(a);
        break;
      case "profile":
        if (a != null) profilePlan(a).exists = true;
        break;
      case "profileField":
        if (a != null && b != null) profilePlan(a).fields.add(b);
        break;
      case "day":
        if (a != null && b != null) dayPlan(a, b).exists = true;
        break;
      case "dayField":
        if (a != null && b != null && c != null) dayPlan(a, b).fields.add(c);
        break;
      case "dayOrder":
        if (a != null && b != null) dayPlan(a, b).order = true;
        break;
      case "entry":
        if (a != null && b != null && c != null) dayPlan(a, b).entries.add(c);
        break;
      case "plan":
        if (a != null && b != null) profilePlan(a).mealPlans.add(b);
        break;
      case "planOrder":
        if (a != null) profilePlan(a).mealPlanOrder = true;
        break;
      case "activeProfile":
        plan.activeProfile = true;
        break;
    }
  }
  return plan;
}

function copyFields<T extends object>(target: T, source: T, names: Iterable<string>): T {
  const result = { ...target } as Record<string, unknown>;
  for (const name of names) {
    const value = field(source, name);
    if (value === undefined) delete result[name];
    else result[name] = value;
  }
  return result as T;
}

/**
 * Moves the `movable` entries of `entries` to where `source` has them: each
 * goes right after the nearest entry that precedes it in `source` and is
 * already placed, or first when there is none. Everything else keeps its
 * place. This keeps an entry logged under Lunch on this device under Lunch,
 * instead of appending it at the end of the day.
 */
function placeLikeSource<T extends { id: string }>(
  entries: ReadonlyArray<T>,
  source: ReadonlyArray<T>,
  movable: ReadonlySet<string>,
): T[] {
  const present = byId(entries);
  const placed = entries.filter((entry) => !movable.has(entry.id));
  source.forEach((sourceEntry, index) => {
    if (!movable.has(sourceEntry.id)) return;
    const entry = present.get(sourceEntry.id);
    if (entry == null) return;
    let position = 0;
    for (let j = index - 1; j >= 0; j--) {
      const at = placed.findIndex((e) => e.id === source[j].id);
      if (at >= 0) {
        position = at + 1;
        break;
      }
    }
    placed.splice(position, 0, entry);
  });
  return placed;
}

function overlayDay(day: DayLog, sourceDay: DayLog, plan: DayPlan): DayLog {
  let result = plan.fields.size > 0 ? copyFields(day, sourceDay, plan.fields) : day;
  if (plan.entries.size === 0 && !plan.order) return result;

  const entries = [...day.entries];
  const sourceEntries = byId(sourceDay.entries);
  for (const id of plan.entries) {
    const sourceEntry = sourceEntries.get(id);
    const at = entries.findIndex((e) => e.id === id);
    // An entry `source` lacks stays: only a tombstone removes one (see overlay).
    if (sourceEntry == null) continue;
    if (at >= 0) entries[at] = sourceEntry;
    else entries.push(sourceEntry);
  }
  const movable = plan.order
    ? new Set(sourceDay.entries.map((e) => e.id))
    : new Set([...plan.entries].filter((id) => sourceEntries.has(id)));
  result = { ...result, entries: placeLikeSource(entries, sourceDay.entries, movable) };
  return result;
}

/**
 * `plans` with `source`'s version of the plans `ids` names. Plans have no
 * tombstones, so one `source` lacks is removed here: the change says this
 * device deleted it.
 */
function overlayPlans(
  plans: ReadonlyArray<SavedMealPlan>,
  source: ReadonlyArray<SavedMealPlan>,
  ids: ReadonlySet<string>,
  order: boolean,
): SavedMealPlan[] {
  const sourcePlans = byId(source);
  const result = plans.filter((p) => !ids.has(p.id) || sourcePlans.has(p.id));
  for (const id of ids) {
    const sourcePlan = sourcePlans.get(id);
    if (sourcePlan == null) continue;
    const at = result.findIndex((p) => p.id === id);
    if (at >= 0) result[at] = sourcePlan;
    else result.push(sourcePlan);
  }
  const movable = order
    ? new Set(source.map((p) => p.id))
    : new Set([...ids].filter((id) => sourcePlans.has(id)));
  return placeLikeSource(result, source, movable);
}

function overlayProfile(profile: Profile, source: Profile, plan: ProfilePlan): Profile {
  let result = plan.fields.size > 0 ? copyFields(profile, source, plan.fields) : profile;
  if (plan.mealPlans.size > 0 || plan.mealPlanOrder) {
    result = {
      ...result,
      mealPlans: overlayPlans(result.mealPlans ?? [], source.mealPlans ?? [], plan.mealPlans, plan.mealPlanOrder),
    };
  }
  if (plan.days.size === 0) return result;

  const days = [...result.dayLogs];
  const sourceDays = byDate(source.dayLogs);
  for (const [date, dayPlan] of plan.days) {
    const sourceDay = sourceDays.get(date);
    const at = days.findIndex((d) => d.date === date);
    if (dayPlan.exists && sourceDay == null) {
      // Only an undo removes a day, and it tombstones the entries it takes
      // out. A day has no tombstone, so instead of disappearing (and coming
      // back from any device that has it) it stays as an empty shell: its own
      // fields (the weight) go, and its entries stay for the tombstones to
      // sort out, since another device may have logged on it meanwhile.
      if (at >= 0) days[at] = { date, entries: days[at].entries };
      continue;
    }
    if (sourceDay == null) continue;
    if (at < 0) {
      days.push(sourceDay);
      continue;
    }
    days[at] = overlayDay(days[at], sourceDay, dayPlan);
  }
  result = { ...result, dayLogs: days };
  return result;
}

/**
 * `base` with `source`'s version of everything `changes` names; the
 * tombstones of both are merged, and then applied. Used to put this device's
 * pending changes on top of a merge with the cloud copy, and to replay an
 * edit made on a snapshot that has moved on since.
 *
 * A food, profile or entry that `source` lacks is never removed here: every
 * deletion in the app leaves a tombstone, and the tombstones remove it. Going
 * by absence alone would also delete what `source` lacks for another reason,
 * such as a local copy another tab overwrote before this one could save.
 */
export function overlay(base: AppData, source: AppData, changes: Iterable<ChangeKey>): AppData {
  const plan = planOverlay(changes);

  let foods: Food[] = base.foods;
  if (plan.foods.size > 0) {
    foods = [...base.foods];
    const sourceFoods = byId(source.foods);
    for (const id of plan.foods) {
      const sourceFood = sourceFoods.get(id);
      if (sourceFood == null) continue;
      const at = foods.findIndex((f) => f.id === id);
      if (at >= 0) foods[at] = sourceFood;
      else foods.push(sourceFood);
    }
  }

  let profiles: Profile[] = base.profiles;
  if (plan.profiles.size > 0) {
    profiles = [...base.profiles];
    const sourceProfiles = byId(source.profiles);
    for (const [id, profilePlan] of plan.profiles) {
      const sourceProfile = sourceProfiles.get(id);
      if (sourceProfile == null) continue;
      const at = profiles.findIndex((p) => p.id === id);
      if (at < 0) profiles.push(sourceProfile);
      else profiles[at] = overlayProfile(profiles[at], sourceProfile, profilePlan);
    }
  }

  return filterDeletedAppEntitiesFromAppData({
    foods,
    profiles,
    activeProfileId: plan.activeProfile ? source.activeProfileId : base.activeProfileId,
    deletedDayLogEntries: mergeDeletedDayLogEntries(
      base.deletedDayLogEntries ?? [],
      source.deletedDayLogEntries ?? [],
    ),
    deletedFoods: mergeDeletedFoods(base.deletedFoods ?? [], source.deletedFoods ?? []),
    deletedProfiles: mergeDeletedProfiles(base.deletedProfiles ?? [], source.deletedProfiles ?? []),
  });
}

/**
 * Replays an edit that was computed from `base` onto `current`, which has
 * moved on since (another tab's write, a pull): only what the edit changed is
 * taken from `next`.
 */
export function rebase(current: AppData, base: AppData, next: AppData): AppData {
  return overlay(current, next, changedKeys(base, next));
}

export interface SyncContext {
  /** This device's changes that no cloud write has carried yet. */
  pending: ReadonlySet<ChangeKey>;
}

export interface PullResult {
  merged: AppData;
  /** This device must adopt `merged`: the cloud had something it lacked. */
  localChanged: boolean;
  /** The cloud must receive `merged`: this device had something it lacked. */
  cloudChanged: boolean;
}

/**
 * The merge both a pull and a save use. The cloud wins on what both sides
 * have (mergeAppData), except for this device's pending changes, which win
 * because they are newer than any copy the cloud has of them.
 */
export function syncMerge(local: AppData, cloud: AppData, context: SyncContext): AppData {
  return overlay(mergeAppData(local, cloud, { fillMissingFromLocal: false }), local, context.pending);
}

/** The same tombstones, in any order: a list of them is a set. */
function sameTombstones(a: ReadonlyArray<object>, b: ReadonlyArray<object>): boolean {
  if (a.length !== b.length) return false;
  const canonical = (t: object) =>
    JSON.stringify(Object.entries(t).filter(([, v]) => v !== undefined).sort(([x], [y]) => (x < y ? -1 : 1)));
  const counts = new Map<string, number>();
  for (const t of a) counts.set(canonical(t), (counts.get(canonical(t)) ?? 0) + 1);
  for (const t of b) {
    const key = canonical(t);
    const left = counts.get(key) ?? 0;
    if (left === 0) return false;
    counts.set(key, left - 1);
  }
  return true;
}

/** Whether `a` and `b` hold the same tombstones of every kind, in any order. */
export function sameTombstoneLists(a: AppData, b: AppData): boolean {
  return (
    sameTombstones(a.deletedDayLogEntries ?? [], b.deletedDayLogEntries ?? []) &&
    sameTombstones(a.deletedFoods ?? [], b.deletedFoods ?? []) &&
    sameTombstones(a.deletedProfiles ?? [], b.deletedProfiles ?? [])
  );
}

/**
 * Canonical equality: the app and Firestore order object keys differently,
 * and two copies that merged the same tombstones in another order hold the
 * same thing. Without this, devices whose tombstone lists only differ in
 * order would keep rewriting the cloud copy on every pull.
 */
export function sameData(a: AppData, b: AppData): boolean {
  return (
    deepEqual(a.foods, b.foods) &&
    deepEqual(a.profiles, b.profiles) &&
    (a.activeProfileId ?? null) === (b.activeProfileId ?? null) &&
    sameTombstoneLists(a, b)
  );
}

function parseChange(change: ChangeKey): string[] | null {
  try {
    const parts: unknown = JSON.parse(change);
    if (!Array.isArray(parts) || !parts.every((part) => typeof part === "string")) return null;
    return parts as string[];
  } catch {
    return null;
  }
}

/**
 * Whether `cloud` already holds the change `change` names the way `local`
 * has it, so it no longer needs to win a merge. A pull uses it to let go of
 * changes that reached the cloud even though this device never heard back
 * (the page closed while the write was landing).
 */
export function changeHolds(change: ChangeKey, local: AppData, cloud: AppData): boolean {
  const parts = parseChange(change);
  if (parts == null) return true;
  const [kind, a, b, c] = parts;
  const profileIn = (d: AppData) => d.profiles.find((p) => p.id === a);
  const dayIn = (d: AppData) => profileIn(d)?.dayLogs.find((day) => day.date === b);
  switch (kind) {
    case "food":
      return deepEqual(
        local.foods.find((f) => f.id === a),
        cloud.foods.find((f) => f.id === a),
      );
    case "profile":
      return (profileIn(local) == null) === (profileIn(cloud) == null);
    case "profileField": {
      const l = profileIn(local);
      const r = profileIn(cloud);
      if (l == null || r == null) return (l == null) === (r == null);
      return deepEqual(field(l, b), field(r, b));
    }
    case "day":
      return (dayIn(local) == null) === (dayIn(cloud) == null);
    case "dayField": {
      const l = dayIn(local);
      const r = dayIn(cloud);
      if (l == null || r == null) return (l == null) === (r == null);
      return deepEqual(field(l, c), field(r, c));
    }
    case "dayOrder": {
      const l = dayIn(local)?.entries ?? [];
      const r = dayIn(cloud)?.entries ?? [];
      return deepEqual(
        commonOrder(l, new Set(r.map((e) => e.id))),
        commonOrder(r, new Set(l.map((e) => e.id))),
      );
    }
    case "entry":
      return deepEqual(
        dayIn(local)?.entries.find((e) => e.id === c),
        dayIn(cloud)?.entries.find((e) => e.id === c),
      );
    case "plan":
      return deepEqual(
        profileIn(local)?.mealPlans?.find((m) => m.id === b),
        profileIn(cloud)?.mealPlans?.find((m) => m.id === b),
      );
    case "planOrder": {
      const l = profileIn(local)?.mealPlans ?? [];
      const r = profileIn(cloud)?.mealPlans ?? [];
      return deepEqual(
        commonOrder(l, new Set(r.map((m) => m.id))),
        commonOrder(r, new Set(l.map((m) => m.id))),
      );
    }
    case "activeProfile":
      return (local.activeProfileId ?? null) === (cloud.activeProfileId ?? null);
    default:
      return true;
  }
}

/** JSON with sorted keys and no undefined fields: equal for deepEqual values. */
function canonical(value: unknown): string {
  if (value === undefined) return "u";
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`).join(",")}}`;
}

/** 32-bit FNV-1a, as 8 hex digits, plus the length: a fingerprint, not a secret. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16).padStart(8, "0")}:${text.length.toString(36)}`;
}

/** What `data` holds for the thing `change` names (see changeHolds). */
function changeValue(change: ChangeKey, data: AppData): unknown {
  const parts = parseChange(change);
  if (parts == null) return undefined;
  const [kind, a, b, c] = parts;
  const profile = data.profiles.find((p) => p.id === a);
  const day = profile?.dayLogs.find((d) => d.date === b);
  switch (kind) {
    case "food":
      return data.foods.find((f) => f.id === a);
    case "profile":
      return profile != null;
    case "profileField":
      return profile == null ? "no profile" : field(profile, b);
    case "day":
      return day != null;
    case "dayField":
      return day == null ? "no day" : field(day, c);
    case "dayOrder":
      return day?.entries.map((e) => e.id);
    case "entry":
      return day?.entries.find((e) => e.id === c);
    case "plan":
      return profile?.mealPlans?.find((m) => m.id === b);
    case "planOrder":
      return profile?.mealPlans?.map((m) => m.id);
    case "activeProfile":
      return data.activeProfileId ?? null;
    default:
      return undefined;
  }
}

/**
 * A fingerprint of `data`'s version of what `change` names. A pending mark
 * stores it, so a mark only lets a copy win when that copy holds the very
 * version the mark was made for.
 */
export function changeFingerprint(change: ChangeKey, data: AppData): string {
  return fnv1a(canonical(changeValue(change, data)));
}

export function mergeForPull(local: AppData, cloud: AppData, context: SyncContext): PullResult {
  const merged = syncMerge(local, cloud, context);
  return {
    merged,
    localChanged: !sameData(merged, local),
    cloudChanged: !sameData(merged, cloud),
  };
}

/**
 * What a save writes over `cloud`, the copy its transaction just read: the
 * same merge as a pull, so a save never drops what another device added or
 * changed. `null` means the cloud copy already holds it all.
 */
export function mergeForSave(
  local: AppData,
  cloud: AppData | null,
  context: SyncContext,
): AppData | null {
  if (cloud == null) return filterDeletedAppEntitiesFromAppData(local);
  const merged = syncMerge(local, cloud, context);
  return sameData(merged, cloud) ? null : merged;
}
