import type { Food, FoodId, NutritionValues } from "./types.js";
import { buildResolvedFoodsMap, comboTotalGrams, computeComboNutritionPer100g } from "./nutrition.js";
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

/**
 * What a food's nutrition is made of, the three kinds the app's Food form
 * offers: per 100 g (optionally with a unit size), per unit only (its weight
 * unknown, logged by units), or a combo of other foods by grams.
 */
export type FoodNutrition =
  | { kind: "per100g"; per100g: NutritionValues; gramsPerUnit: number | null }
  | { kind: "perUnit"; perUnit: NutritionValues }
  | { kind: "combo"; ingredients: ReadonlyArray<{ foodId: string; grams: number }> };

export interface NewFood {
  id: string;
  name: string;
  imageUrl: string | null;
  nutrition: FoodNutrition;
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

/** An image URL as the form takes one: trimmed, http(s) only, null when empty. */
export function cleanImageUrl(url: string | null): string | null {
  const trimmed = url?.trim() ?? "";
  if (trimmed.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new EstimateError(`"${trimmed}" is not a URL.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new EstimateError("image_url must be an http(s) URL.");
  return trimmed;
}

/**
 * Ids of `foodId` and of every combo that contains it, directly or through
 * another combo: none of them can be an ingredient of `foodId`.
 */
function foodsContaining(foods: ReadonlyArray<Food>, foodId: string): Set<string> {
  const forbidden = new Set([foodId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of foods) {
      if (forbidden.has(f.id) || f.ingredients == null) continue;
      if (f.ingredients.some((i) => forbidden.has(i.foodId))) {
        forbidden.add(f.id);
        changed = true;
      }
    }
  }
  return forbidden;
}

/** The nutrition fields of a food, shaped as FoodForm stores each kind. */
function nutritionFields(doc: FsDocument, foodId: string, nutrition: FoodNutrition): Record<string, FsValue> {
  const zero = { calories: 0, protein: 0, saturatedFat: 0, fiber: 0 };
  switch (nutrition.kind) {
    case "per100g":
      if (nutrition.gramsPerUnit != null && !(nutrition.gramsPerUnit > 0)) throw new EstimateError("grams_per_unit must be more than 0.");
      return {
        nutritionPer100g: nutritionValue(nutrition.per100g),
        nutritionPerUnit: { nullValue: null },
        gramsPerUnit: nutrition.gramsPerUnit == null ? { nullValue: null } : numberValue(nutrition.gramsPerUnit),
        ingredients: { nullValue: null },
      };
    case "perUnit":
      return {
        nutritionPer100g: nutritionValue(zero),
        nutritionPerUnit: nutritionValue(nutrition.perUnit),
        gramsPerUnit: { nullValue: null },
        ingredients: { nullValue: null },
      };
    case "combo": {
      const { ingredients } = nutrition;
      if (ingredients.length === 0) throw new EstimateError("A combo needs at least one ingredient.");
      const foods = liveFoods(doc);
      const resolved = buildResolvedFoodsMap(foods);
      const forbidden = foodsContaining(foods, foodId);
      for (const ing of ingredients) {
        const f = resolved.get(ing.foodId);
        if (f == null) throw new EstimateError(`No food with id ${ing.foodId} in Foods.`);
        if (!(ing.grams > 0)) throw new EstimateError(`${f.name}: grams must be more than 0.`);
        if (f.nutritionPerUnit != null) throw new EstimateError(`${f.name} is logged by units only, so it can't go in a combo.`);
        if (forbidden.has(ing.foodId)) throw new EstimateError(`${f.name} contains this food, so it can't be one of its ingredients.`);
      }
      const list = ingredients.map((i) => ({ foodId: i.foodId as FoodId, grams: round2(i.grams) }));
      const total = comboTotalGrams(list);
      return {
        nutritionPer100g: nutritionValue(computeComboNutritionPer100g(list, resolved)),
        nutritionPerUnit: { nullValue: null },
        gramsPerUnit: total > 0 ? numberValue(round2(total)) : { nullValue: null },
        ingredients: {
          arrayValue: {
            values: list.map((i) => ({ mapValue: { fields: { foodId: { stringValue: i.foodId }, grams: numberValue(i.grams) } } })),
          },
        },
      };
    }
  }
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new EstimateError("The food needs a name.");
  return trimmed;
}

function refuseTakenName(doc: FsDocument, name: string, exceptId: string | null): void {
  const wanted = normalize(name);
  const same = liveFoods(doc).find((f) => f.id !== exceptId && normalize(f.name) === wanted);
  if (same != null) throw new EstimateError(`Foods already has "${same.name}" (id ${same.id}).`);
}

/** A food shaped as the app stores one. */
export function foodValue(doc: FsDocument, food: NewFood): FsValue {
  return {
    mapValue: {
      fields: {
        id: { stringValue: food.id },
        name: { stringValue: cleanName(food.name) },
        imageUrl: food.imageUrl == null ? { nullValue: null } : { stringValue: food.imageUrl },
        ...nutritionFields(doc, food.id, food.nutrition),
        createdAt: { stringValue: food.createdAt },
      },
    },
  };
}

/** `foods` with `food` appended. Refuses a name a live food already has. */
export function foodsWithAddedFood(doc: FsDocument, food: NewFood): FsValue {
  const value = foodValue(doc, food);
  refuseTakenName(doc, food.name, null);
  const foods = arrayValues(doc.fields.foods) ?? [];
  if (foods.some((f) => str(mapFields(f)?.id) === food.id)) throw new EstimateError(`A food with id ${food.id} exists.`);
  return { arrayValue: { values: [...foods, value] } };
}

/** What to change in a food: only the fields given change. */
export interface FoodPatch {
  name?: string;
  /** null removes the image. */
  imageUrl?: string | null;
  nutrition?: FoodNutrition;
}

/**
 * `foods` with the live food `foodId` changed by `patch`, as the Food form's
 * edit does (it keeps the id and createdAt, so every logged entry follows).
 * Returns the index replaced, for onlyListGrew.
 */
export function foodsWithUpdatedFood(
  doc: FsDocument,
  foodId: string,
  patch: FoodPatch,
): { value: FsValue; replacedIndex: number } {
  if (!liveFoods(doc).some((f) => f.id === foodId)) throw new EstimateError(`No food with id ${foodId} in Foods.`);
  const foods = arrayValues(doc.fields.foods) ?? [];
  const at = foods.findIndex((f) => str(mapFields(f)?.id) === foodId);
  if (at < 0) throw new EstimateError(`No food with id ${foodId} in Foods.`);
  const fields: Record<string, FsValue> = { ...(mapFields(foods[at]) ?? {}) };
  if (patch.name !== undefined) {
    const name = cleanName(patch.name);
    refuseTakenName(doc, name, foodId);
    fields.name = { stringValue: name };
  }
  if (patch.imageUrl !== undefined) {
    fields.imageUrl = patch.imageUrl == null ? { nullValue: null } : { stringValue: patch.imageUrl };
  }
  if (patch.nutrition !== undefined) Object.assign(fields, nutritionFields(doc, foodId, patch.nutrition));
  const updated: FsValue = { mapValue: { fields } };
  if (canonical(updated) === canonical(foods[at])) throw new EstimateError("Nothing to change: the food already is like that.");
  return { value: { arrayValue: { values: foods.map((f, i) => (i === at ? updated : f)) } }, replacedIndex: at };
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
