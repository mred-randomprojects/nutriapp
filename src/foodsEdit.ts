import type { Food, NutritionValues } from "./types.js";
import { appDataFromRaw } from "./cloudDoc.js";
import { fsToJs } from "./dayView.js";
import { normalize } from "./addEntry.js";
import {
  EstimateError,
  arrayValues,
  canonical,
  mapFields,
  numberValue,
  str,
  type FsDocument,
  type FsValue,
} from "./estimateEntry.js";

/**
 * The food database and food-database entries, from outside the app (the
 * NutriApp MCP server), on the raw Firestore value tree like addEntry.ts:
 * finding foods, adding one to Foods, logging a food by grams or units, and
 * removing a day-log entry the way the app does (a tombstone in
 * deletedDayLogEntries, which the app can undo). The app takes each change on
 * its next pull: foods merge by id and tombstones merge by max
 * (src/syncMerge.ts).
 */

/** The live (not deleted) foods of the document, decoded. */
export function liveFoods(doc: FsDocument): Food[] {
  const raw = Object.fromEntries(Object.entries(doc.fields).map(([k, v]) => [k, fsToJs(v)]));
  const data = appDataFromRaw(raw);
  const deleted = new Set(
    (data.deletedFoods ?? []).filter((t) => t.restoredAt == null || t.restoredAt <= t.deletedAt).map((t) => t.foodId),
  );
  return data.foods.filter((f) => !deleted.has(f.id));
}

/** Foods whose name has every word of `query` (ignoring case and accents); all of them when it is empty. */
export function findFoods(doc: FsDocument, query: string): Food[] {
  const words = normalize(query).split(" ").filter((w) => w.length > 0);
  return liveFoods(doc).filter((f) => {
    const name = normalize(f.name);
    return words.every((w) => name.includes(w));
  });
}

export interface NewFood {
  id: string;
  name: string;
  per100g: NutritionValues;
  gramsPerUnit: number | null;
  createdAt: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function nutritionValue(n: NutritionValues): FsValue {
  return {
    mapValue: {
      fields: {
        calories: numberValue(round2(n.calories)),
        protein: numberValue(round2(n.protein)),
        saturatedFat: numberValue(round2(n.saturatedFat)),
        fiber: numberValue(round2(n.fiber)),
      },
    },
  };
}

/** A plain (not combo, not unit-only) food, shaped as the app stores one. */
export function foodValue(food: NewFood): FsValue {
  const name = food.name.trim();
  if (name.length === 0) throw new EstimateError("The food needs a name.");
  if (food.gramsPerUnit != null && !(food.gramsPerUnit > 0)) throw new EstimateError("grams_per_unit must be more than 0.");
  return {
    mapValue: {
      fields: {
        id: { stringValue: food.id },
        name: { stringValue: name },
        imageUrl: { nullValue: null },
        nutritionPer100g: nutritionValue(food.per100g),
        nutritionPerUnit: { nullValue: null },
        gramsPerUnit: food.gramsPerUnit == null ? { nullValue: null } : numberValue(food.gramsPerUnit),
        ingredients: { nullValue: null },
        createdAt: { stringValue: food.createdAt },
      },
    },
  };
}

/** `foods` with `food` appended. Refuses a name a live food already has. */
export function foodsWithAddedFood(doc: FsDocument, food: NewFood): FsValue {
  const value = foodValue(food);
  const name = normalize(food.name);
  const same = liveFoods(doc).find((f) => normalize(f.name) === name);
  if (same != null) throw new EstimateError(`Foods already has "${same.name}" (id ${same.id}): log that one.`);
  const foods = arrayValues(doc.fields.foods) ?? [];
  if (foods.some((f) => str(mapFields(f)?.id) === food.id)) throw new EstimateError(`A food with id ${food.id} exists.`);
  return { arrayValue: { values: [...foods, value] } };
}

export interface NewFoodEntry {
  id: string;
  food: Food;
  /** Exactly one of grams and units. */
  grams: number | null;
  units: number | null;
  notes: string | null;
  budgeted: boolean;
}

/**
 * A food-database entry as AddEntryDialog stores one: by grams (units of a
 * food with a unit size become units × grams per unit), or, for a unit-only
 * food, units with grams 0.
 */
export function foodEntryValue(entry: NewFoodEntry): FsValue {
  const { food } = entry;
  if ((entry.grams == null) === (entry.units == null)) throw new EstimateError("Pass either grams or units, not both.");
  const fields: Record<string, FsValue> = { id: { stringValue: entry.id }, foodId: { stringValue: food.id } };
  if (entry.units != null) {
    if (!(entry.units > 0)) throw new EstimateError("units must be more than 0.");
    if (food.nutritionPerUnit != null) {
      fields.grams = numberValue(0);
      fields.units = numberValue(entry.units);
    } else if (food.gramsPerUnit != null) {
      fields.grams = numberValue(round2(entry.units * food.gramsPerUnit));
    } else {
      throw new EstimateError(`${food.name} has no unit size: log it by grams.`);
    }
  } else {
    const grams = entry.grams ?? 0;
    if (!(grams > 0)) throw new EstimateError("grams must be more than 0.");
    if (food.nutritionPerUnit != null) throw new EstimateError(`${food.name} is logged by units only.`);
    fields.grams = numberValue(round2(grams));
  }
  const notes = entry.notes?.trim() ?? "";
  if (notes.length > 0) fields.notes = { stringValue: notes };
  if (entry.budgeted) fields.isBudgeted = { booleanValue: true };
  return { mapValue: { fields } };
}

/**
 * Whether `after` is `before` with only `field` changed, to exactly
 * `expected`, and `expected` is the old list plus `appended` at its end
 * (or, with `replacedIndex`, the old list with that one item replaced).
 */
export function onlyListGrew(
  before: FsDocument,
  after: Record<string, FsValue>,
  field: string,
  expected: FsValue,
  replacedIndex: number | null = null,
): string | null {
  const keys = new Set([...Object.keys(before.fields), ...Object.keys(after)]);
  for (const key of keys) {
    if (key === field) continue;
    if (canonical(before.fields[key]) !== canonical(after[key])) return `Field "${key}" changed.`;
  }
  if (canonical(after[field]) !== canonical(expected)) return `The ${field} are not the ones sent.`;
  const old = arrayValues(before.fields[field]) ?? [];
  const now = arrayValues(after[field]) ?? [];
  const kept =
    replacedIndex == null ? now.slice(0, -1) : now.map((v, i) => (i === replacedIndex ? old[i] : v));
  if (now.length !== old.length + (replacedIndex == null ? 1 : 0) || canonical(kept) !== canonical(old)) {
    return `Something besides the one item changed in ${field}.`;
  }
  return null;
}

/**
 * `deletedDayLogEntries` with `entryId` of `date` marked deleted at `now`, as
 * the app's delete does: a new tombstone, or a fresh deletedAt on one the app
 * had restored. Refuses an entry that isn't there or is already deleted.
 */
export function tombstonesWithDeleted(
  doc: FsDocument,
  profileName: string,
  date: string,
  entryId: string,
  now: string,
): { value: FsValue; replacedIndex: number | null } {
  const profiles = arrayValues(doc.fields.profiles) ?? [];
  const profile = profiles.map((p) => mapFields(p) ?? {}).find((p) => str(p.name) === profileName);
  if (profile == null) throw new EstimateError(`No profile named "${profileName}".`);
  const profileId = str(profile.id) ?? "";
  const day = (arrayValues(profile.dayLogs) ?? []).map((d) => mapFields(d) ?? {}).find((d) => str(d.date) === date);
  const entries = arrayValues(day?.entries) ?? [];
  if (!entries.some((e) => str(mapFields(e)?.id) === entryId)) throw new EstimateError(`No entry ${entryId} on ${date}.`);

  const tombstones = arrayValues(doc.fields.deletedDayLogEntries) ?? [];
  const at = tombstones.findIndex((t) => {
    const f = mapFields(t) ?? {};
    return str(f.profileId) === profileId && str(f.date) === date && str(f.entryId) === entryId;
  });
  if (at < 0) {
    const tombstone: FsValue = {
      mapValue: {
        fields: {
          profileId: { stringValue: profileId },
          date: { stringValue: date },
          entryId: { stringValue: entryId },
          deletedAt: { stringValue: now },
        },
      },
    };
    return { value: { arrayValue: { values: [...tombstones, tombstone] } }, replacedIndex: null };
  }
  const f = mapFields(tombstones[at]) ?? {};
  const restoredAt = str(f.restoredAt);
  const deletedAt = str(f.deletedAt) ?? "";
  if (restoredAt == null || restoredAt <= deletedAt) throw new EstimateError(`Entry ${entryId} is already deleted.`);
  const renewed: FsValue = { mapValue: { fields: { ...f, deletedAt: { stringValue: now } } } };
  return { value: { arrayValue: { values: tombstones.map((t, i) => (i === at ? renewed : t)) } }, replacedIndex: at };
}
