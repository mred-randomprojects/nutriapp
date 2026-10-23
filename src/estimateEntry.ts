import type { NutritionValues } from "./types.js";

/**
 * Filling in the nutrition of a quick-add entry from outside the app (the
 * `npm run nutri` CLI), straight on the cloud document as the Firestore REST
 * API returns it. Everything here works on that raw value tree on purpose:
 * decoding the document into AppData and encoding it back could turn a
 * stored 5.0 (doubleValue) into 5 (integerValue) or drop a field this
 * checkout does not know. Only the one entry's `nutrition` and `notes` are
 * rebuilt; every other value is carried over byte for byte.
 */

export type FsValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { timestampValue: string }
  | { mapValue: { fields?: Record<string, FsValue> } }
  | { arrayValue: { values?: FsValue[] } };

export interface FsDocument {
  name: string;
  fields: Record<string, FsValue>;
  createTime?: string;
  updateTime: string;
}

export class EstimateError extends Error {}

function mapFields(value: FsValue | undefined): Record<string, FsValue> | null {
  return value != null && "mapValue" in value ? (value.mapValue.fields ?? {}) : null;
}

function arrayValues(value: FsValue | undefined): FsValue[] | null {
  return value != null && "arrayValue" in value ? (value.arrayValue.values ?? []) : null;
}

function str(value: FsValue | undefined): string | null {
  return value != null && "stringValue" in value ? value.stringValue : null;
}

function num(value: FsValue | undefined): number | null {
  if (value == null) return null;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  return null;
}

export interface DayEntrySummary {
  index: number;
  id: string;
  type: "food" | "quick-add" | "separator";
  name: string;
  calories: number | null;
  budgeted: boolean;
}

export interface EntryLocation {
  profileIndex: number;
  dayIndex: number;
  entryIndex: number;
}

function findDay(
  doc: FsDocument,
  profileName: string,
  date: string,
): { profileIndex: number; profileId: string; dayIndex: number; entries: FsValue[] } {
  const profiles = arrayValues(doc.fields.profiles);
  if (profiles == null) throw new EstimateError("The document has no profiles list.");
  const profileIndex = profiles.findIndex((p) => str(mapFields(p)?.name) === profileName);
  if (profileIndex < 0) throw new EstimateError(`No profile named "${profileName}".`);
  const dayLogs = arrayValues(mapFields(profiles[profileIndex])?.dayLogs) ?? [];
  const dayIndex = dayLogs.findIndex((d) => str(mapFields(d)?.date) === date);
  if (dayIndex < 0) throw new EstimateError(`"${profileName}" has nothing logged on ${date}.`);
  const profileId = str(mapFields(profiles[profileIndex])?.id) ?? "";
  return { profileIndex, profileId, dayIndex, entries: arrayValues(mapFields(dayLogs[dayIndex])?.entries) ?? [] };
}

/** The ids of the day-log entries the app has deleted (and not restored) on `date`. */
function deletedEntryIds(doc: FsDocument, profileId: string, date: string): Set<string> {
  const out = new Set<string>();
  for (const t of arrayValues(doc.fields.deletedDayLogEntries) ?? []) {
    const f = mapFields(t);
    if (f == null || str(f.date) !== date || str(f.profileId) !== profileId) continue;
    const deletedAt = str(f.deletedAt);
    const restoredAt = str(f.restoredAt);
    if (restoredAt != null && deletedAt != null && restoredAt > deletedAt) continue;
    const id = str(f.entryId);
    if (id != null) out.add(id);
  }
  return out;
}

/** The day's entries, for picking one by id; deleted ones are left out. */
export function listDay(doc: FsDocument, profileName: string, date: string): DayEntrySummary[] {
  const { entries, profileId } = findDay(doc, profileName, date);
  const deleted = deletedEntryIds(doc, profileId, date);
  const foodNames = new Map<string, string>();
  for (const food of arrayValues(doc.fields.foods) ?? []) {
    const ff = mapFields(food);
    const id = str(ff?.id);
    const name = str(ff?.name);
    if (id != null && name != null) foodNames.set(id, name);
  }
  const out: DayEntrySummary[] = [];
  entries.forEach((e, index) => {
    const f = mapFields(e) ?? {};
    const id = str(f.id) ?? "";
    if (deleted.has(id)) return;
    const type = str(f.type);
    out.push({
      index,
      id,
      type: type === "quick-add" ? "quick-add" : type === "separator" ? "separator" : "food",
      name: str(f.name) ?? str(f.label) ?? foodNames.get(str(f.foodId) ?? "") ?? str(f.foodId) ?? "?",
      calories: type === "quick-add" ? num(mapFields(f.nutrition)?.calories) : null,
      budgeted: f.isBudgeted != null && "booleanValue" in f.isBudgeted && f.isBudgeted.booleanValue,
    });
  });
  return out;
}

/**
 * Where the quick-add entry `entryId` of `date` is. Refuses anything but a
 * live quick-add, and one that already has calories unless `force`.
 */
export function locateQuickAdd(
  doc: FsDocument,
  profileName: string,
  date: string,
  entryId: string,
  force: boolean,
): EntryLocation {
  const { profileIndex, profileId, dayIndex, entries } = findDay(doc, profileName, date);
  const matches = entries.flatMap((e, i) => (str(mapFields(e)?.id) === entryId ? [i] : []));
  if (matches.length !== 1) {
    throw new EstimateError(`Expected exactly one entry with id ${entryId} on ${date}, found ${matches.length}.`);
  }
  if (deletedEntryIds(doc, profileId, date).has(entryId)) throw new EstimateError(`Entry ${entryId} was deleted in the app.`);
  const f = mapFields(entries[matches[0]]) ?? {};
  if (str(f.type) !== "quick-add") {
    throw new EstimateError(`Entry ${entryId} is not a quick-add: only those carry their own nutrition.`);
  }
  const current = num(mapFields(f.nutrition)?.calories) ?? 0;
  if (current > 0 && !force) {
    throw new EstimateError(`Entry ${entryId} already has ${current} kcal; pass --force to replace them.`);
  }
  return { profileIndex, dayIndex, entryIndex: matches[0] };
}

function numberValue(n: number): FsValue {
  if (!Number.isFinite(n) || n < 0) throw new EstimateError(`Not a valid amount: ${n}.`);
  return Number.isInteger(n) ? { integerValue: String(n) } : { doubleValue: n };
}

/** A copy of `fields` with `key` set; a copy, so the input document stays the "before". */
function withField(fields: Record<string, FsValue>, key: string, value: FsValue): Record<string, FsValue> {
  return { ...fields, [key]: value };
}

function withItem(values: FsValue[], index: number, value: FsValue): FsValue[] {
  return values.map((v, i) => (i === index ? value : v));
}

/**
 * `profiles` with the located entry's nutrition replaced (and `note` set as
 * its notes, when given). Nothing else in the tree is rebuilt.
 */
export function profilesWithEstimate(
  doc: FsDocument,
  loc: EntryLocation,
  nutrition: NutritionValues,
  note: string | null,
): FsValue {
  const profiles = arrayValues(doc.fields.profiles) ?? [];
  const profile = mapFields(profiles[loc.profileIndex]) ?? {};
  const dayLogs = arrayValues(profile.dayLogs) ?? [];
  const day = mapFields(dayLogs[loc.dayIndex]) ?? {};
  const entries = arrayValues(day.entries) ?? [];
  let entry = withField(mapFields(entries[loc.entryIndex]) ?? {}, "nutrition", {
    mapValue: {
      fields: {
        calories: numberValue(nutrition.calories),
        protein: numberValue(nutrition.protein),
        saturatedFat: numberValue(nutrition.saturatedFat),
        fiber: numberValue(nutrition.fiber),
      },
    },
  });
  if (note != null) entry = withField(entry, "notes", { stringValue: note });
  const newDay = withField(day, "entries", { arrayValue: { values: withItem(entries, loc.entryIndex, { mapValue: { fields: entry } }) } });
  const newProfile = withField(profile, "dayLogs", { arrayValue: { values: withItem(dayLogs, loc.dayIndex, { mapValue: { fields: newDay } }) } });
  return { arrayValue: { values: withItem(profiles, loc.profileIndex, { mapValue: { fields: newProfile } }) } };
}

/** JSON with sorted object keys: Firestore maps have no key order, arrays do. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v == null || typeof v !== "object" || Array.isArray(v)
      ? v
      : Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  );
}

/**
 * Whether `after` is `before` with only the located entry changed, and that
 * entry exactly `expectedEntry`. The CLI checks it on what it is about to
 * send and on what Firestore answers, so a bug here writes nothing.
 */
export function onlyEntryChanged(
  before: FsDocument,
  after: Record<string, FsValue>,
  loc: EntryLocation,
  expectedProfiles: FsValue,
): string | null {
  const keys = new Set([...Object.keys(before.fields), ...Object.keys(after)]);
  for (const key of keys) {
    if (key === "profiles") continue;
    if (canonical(before.fields[key]) !== canonical(after[key])) return `Field "${key}" changed.`;
  }
  if (canonical(after.profiles) !== canonical(expectedProfiles)) return "The profiles are not the ones sent.";
  // And the sent profiles differ from the stored ones only in that entry:
  const strip = (profilesValue: FsValue | undefined): string => {
    const profiles = arrayValues(profilesValue) ?? [];
    const profile = mapFields(profiles[loc.profileIndex]) ?? {};
    const dayLogs = arrayValues(profile.dayLogs) ?? [];
    const day = mapFields(dayLogs[loc.dayIndex]) ?? {};
    const entries = withItem(arrayValues(day.entries) ?? [], loc.entryIndex, { nullValue: null });
    const d = withField(day, "entries", { arrayValue: { values: entries } });
    const p = withField(profile, "dayLogs", { arrayValue: { values: withItem(dayLogs, loc.dayIndex, { mapValue: { fields: d } }) } });
    return canonical(withItem(profiles, loc.profileIndex, { mapValue: { fields: p } }));
  };
  if (strip(before.fields.profiles) !== strip(after.profiles)) return "Something besides the entry changed in the profiles.";
  return null;
}
