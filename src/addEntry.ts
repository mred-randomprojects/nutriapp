import type { NutritionValues } from "./types.js";
import {
  EstimateError,
  arrayValues,
  canonical,
  deletedEntryIds,
  mapFields,
  numberValue,
  str,
  withField,
  withItem,
  type FsDocument,
  type FsValue,
} from "./estimateEntry.js";

/**
 * Logging a new quick-add entry from outside the app (the NutriApp MCP server
 * and `npm run nutri -- add`), straight on the cloud document as the
 * Firestore REST API returns it. Like estimateEntry.ts, it works on the raw
 * value tree so that every value it does not add is carried over byte for
 * byte. The app takes the entry on its next pull: day logs merge entry by
 * entry (src/syncMerge.ts), so an entry with a fresh id survives any edit a
 * device still has pending, on that day or any other.
 */

export interface NewQuickAdd {
  id: string;
  name: string;
  nutrition: NutritionValues;
  notes: string | null;
  budgeted: boolean;
}

export interface AddLocation {
  profileIndex: number;
  dayIndex: number;
  entryIndex: number;
  /** The day had no log yet, so the whole day was added. */
  newDay: boolean;
}

/** Rounded to 0.1, as the app's quick-add dialog does. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function quickAddValue(entry: NewQuickAdd): FsValue {
  const name = entry.name.trim();
  if (name.length === 0) throw new EstimateError("The entry needs a name.");
  const n = entry.nutrition;
  const fields: Record<string, FsValue> = {
    type: { stringValue: "quick-add" },
    id: { stringValue: entry.id },
    name: { stringValue: name },
    nutrition: {
      mapValue: {
        fields: {
          calories: numberValue(round1(n.calories)),
          protein: numberValue(round1(n.protein)),
          saturatedFat: numberValue(round1(n.saturatedFat)),
          fiber: numberValue(round1(n.fiber)),
        },
      },
    },
  };
  const notes = entry.notes?.trim() ?? "";
  if (notes.length > 0) fields.notes = { stringValue: notes };
  if (entry.budgeted) fields.isBudgeted = { booleanValue: true };
  return { mapValue: { fields } };
}

/** Lowercase, no accents, single spaces: "Almuerzo " matches "ALMUERZO (12:30)". */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** The live section separators of a day, in order. */
export function daySections(entries: FsValue[], deleted: ReadonlySet<string>): Array<{ index: number; label: string }> {
  const out: Array<{ index: number; label: string }> = [];
  entries.forEach((e, index) => {
    const f = mapFields(e) ?? {};
    if (str(f.type) !== "separator" || deleted.has(str(f.id) ?? "")) return;
    out.push({ index, label: str(f.label) ?? "" });
  });
  return out;
}

/**
 * Where an entry for `section` goes: at the end of that section, right before
 * the next live separator. The section is matched by label, ignoring case and
 * accents: an exact match first, else the one label that contains it.
 */
export function insertIndexForSection(entries: FsValue[], deleted: ReadonlySet<string>, section: string): number {
  const sections = daySections(entries, deleted);
  const query = normalize(section);
  const exact = sections.filter((s) => normalize(s.label) === query);
  const partial = sections.filter((s) => normalize(s.label).includes(query));
  const matches = exact.length > 0 ? exact : partial;
  if (matches.length !== 1) {
    const labels = sections.map((s) => `"${s.label}"`).join(", ") || "none";
    throw new EstimateError(
      `${matches.length === 0 ? "No" : "More than one"} section matches "${section}". The day's sections: ${labels}.`,
    );
  }
  const next = sections.find((s) => s.index > matches[0].index);
  return next == null ? entries.length : next.index;
}

/**
 * `profiles` with `entry` added to `date` of `profileName`: at the end of
 * `section`, or at the end of the day when `section` is null. A date with no
 * log yet gets a new day holding only the entry. Nothing else is rebuilt.
 */
export function profilesWithAddedEntry(
  doc: FsDocument,
  profileName: string,
  date: string,
  entry: NewQuickAdd,
  section: string | null,
): { profiles: FsValue; loc: AddLocation } {
  return profilesWithAddedValue(doc, profileName, date, { id: entry.id, value: quickAddValue(entry) }, section);
}

/**
 * The same for any built entry value (a quick-add, or a food-database entry
 * from foodsEdit.ts) whose id is `entry.id`.
 */
export function profilesWithAddedValue(
  doc: FsDocument,
  profileName: string,
  date: string,
  entry: { id: string; value: FsValue },
  section: string | null,
): { profiles: FsValue; loc: AddLocation } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new EstimateError(`Not a date (YYYY-MM-DD): "${date}".`);
  const value = entry.value;
  const profiles = arrayValues(doc.fields.profiles);
  if (profiles == null) throw new EstimateError("The document has no profiles list.");
  const profileIndex = profiles.findIndex((p) => str(mapFields(p)?.name) === profileName);
  if (profileIndex < 0) throw new EstimateError(`No profile named "${profileName}".`);
  const profile = mapFields(profiles[profileIndex]) ?? {};
  const profileId = str(profile.id) ?? "";
  const dayLogs = arrayValues(profile.dayLogs) ?? [];
  const dayIndex = dayLogs.findIndex((d) => str(mapFields(d)?.date) === date);

  let newDayLogs: FsValue[];
  let loc: AddLocation;
  if (dayIndex < 0) {
    if (section != null) {
      throw new EstimateError(`Nothing is logged on ${date} yet, so it has no sections: add it without one.`);
    }
    const day: FsValue = { mapValue: { fields: { date: { stringValue: date }, entries: { arrayValue: { values: [value] } } } } };
    newDayLogs = [...dayLogs, day];
    loc = { profileIndex, dayIndex: dayLogs.length, entryIndex: 0, newDay: true };
  } else {
    const day = mapFields(dayLogs[dayIndex]) ?? {};
    const entries = arrayValues(day.entries) ?? [];
    if (entries.some((e) => str(mapFields(e)?.id) === entry.id)) {
      throw new EstimateError(`${date} already has an entry with id ${entry.id}.`);
    }
    const deleted = deletedEntryIds(doc, profileId, date);
    const at = section == null ? entries.length : insertIndexForSection(entries, deleted, section);
    const newEntries = [...entries.slice(0, at), value, ...entries.slice(at)];
    const newDay = withField(day, "entries", { arrayValue: { values: newEntries } });
    newDayLogs = withItem(dayLogs, dayIndex, { mapValue: { fields: newDay } });
    loc = { profileIndex, dayIndex, entryIndex: at, newDay: false };
  }
  const newProfile = withField(profile, "dayLogs", { arrayValue: { values: newDayLogs } });
  return {
    profiles: { arrayValue: { values: withItem(profiles, profileIndex, { mapValue: { fields: newProfile } }) } },
    loc,
  };
}

function withoutItem(values: FsValue[], index: number): FsValue[] {
  return values.filter((_v, i) => i !== index);
}

/**
 * Whether `after` is `before` with only the one entry (or the one new day)
 * added at `loc`, and the profiles exactly `expectedProfiles`. Checked on what
 * is about to be sent and again on what Firestore stored, so a bug here
 * writes nothing.
 */
export function onlyEntryAdded(
  before: FsDocument,
  after: Record<string, FsValue>,
  loc: AddLocation,
  expectedProfiles: FsValue,
): string | null {
  const keys = new Set([...Object.keys(before.fields), ...Object.keys(after)]);
  for (const key of keys) {
    if (key === "profiles") continue;
    if (canonical(before.fields[key]) !== canonical(after[key])) return `Field "${key}" changed.`;
  }
  if (canonical(after.profiles) !== canonical(expectedProfiles)) return "The profiles are not the ones sent.";
  const profiles = arrayValues(after.profiles) ?? [];
  const profile = mapFields(profiles[loc.profileIndex]) ?? {};
  const dayLogs = arrayValues(profile.dayLogs) ?? [];
  let strippedDays: FsValue[];
  if (loc.newDay) {
    strippedDays = withoutItem(dayLogs, loc.dayIndex);
  } else {
    const day = mapFields(dayLogs[loc.dayIndex]) ?? {};
    const entries = withoutItem(arrayValues(day.entries) ?? [], loc.entryIndex);
    strippedDays = withItem(dayLogs, loc.dayIndex, { mapValue: { fields: withField(day, "entries", { arrayValue: { values: entries } }) } });
  }
  const stripped = withItem(profiles, loc.profileIndex, {
    mapValue: { fields: withField(profile, "dayLogs", { arrayValue: { values: strippedDays } }) },
  });
  if (canonical(stripped) !== canonical(arrayValues(before.fields.profiles) ?? [])) {
    return "Something besides the new entry changed in the profiles.";
  }
  return null;
}
