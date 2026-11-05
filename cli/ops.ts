/**
 * The writes the terminal tools make, each one safe by construction:
 *   - before writing, the whole document is saved to ~/.nutriapp/backups/;
 *   - the write carries the document's update time as a precondition, so if
 *     the app saved in between, Firestore refuses it and nothing changes
 *     (the operation then starts over once, from a fresh read);
 *   - it checks, before sending and again on what Firestore stored, that the
 *     one entry is the only thing that changed.
 */
import { randomUUID } from "node:crypto";
import type { Food, NutritionValues } from "../src/types.js";
import { onlyEntryAdded, profilesWithAddedEntry, profilesWithAddedValue } from "../src/addEntry.js";
import {
  findFoods,
  foodEntryValue,
  foodsWithAddedFood,
  foodsWithUpdatedFood,
  type FoodNutrition,
  type FoodPatch,
  liveFoods,
  onlyListGrew,
  tombstonesWithDeleted,
} from "../src/foodsEdit.js";
import { dayView, type DayView } from "../src/dayView.js";
import {
  EstimateError,
  locateQuickAdd,
  onlyEntryChanged,
  profilesWithEstimate,
  type FsDocument,
  type FsValue,
} from "../src/estimateEntry.js";
import { PROFILE, StaleDocumentError, backupDoc, readDoc, writeField } from "./firestore.js";

export interface WriteResult {
  entryId: string;
  backup: string;
  day: DayView;
}

interface Planned {
  /** The one top-level field written; "profiles" when omitted. */
  field?: string;
  /** Its new value. */
  value: FsValue;
  /** Null when `after` is exactly `before` plus the planned change. */
  check: (before: FsDocument, after: Record<string, FsValue>) => string | null;
}

async function writeVerified(entryId: string, date: string, plan: (doc: FsDocument) => Planned): Promise<WriteResult> {
  for (let attempt = 1; ; attempt++) {
    const doc = await readDoc();
    const planned = plan(doc);
    const field = planned.field ?? "profiles";
    const problem = planned.check(doc, { ...doc.fields, [field]: planned.value });
    if (problem != null) throw new EstimateError(`Refusing to write: ${problem}`);
    const backup = backupDoc(doc);
    let stored: FsDocument;
    try {
      stored = await writeField(doc, field, planned.value);
    } catch (error) {
      if (error instanceof StaleDocumentError && attempt < 2) continue;
      throw error;
    }
    const check = planned.check(doc, stored.fields);
    if (check != null) {
      throw new Error(`Written, but the stored document is not what was expected (${check}). Restore from ${backup} if needed.`);
    }
    return { entryId, backup, day: dayView(stored, PROFILE, date) };
  }
}

export interface AddMealInput {
  date: string;
  name: string;
  nutrition: NutritionValues;
  notes: string | null;
  section: string | null;
  planned: boolean;
}

export function addMeal(input: AddMealInput): Promise<WriteResult> {
  const id = randomUUID();
  const entry = { id, name: input.name, nutrition: input.nutrition, notes: input.notes, budgeted: input.planned };
  return writeVerified(id, input.date, (doc) => {
    const { profiles, loc } = profilesWithAddedEntry(doc, PROFILE, input.date, entry, input.section);
    return { value: profiles, check: (before, after) => onlyEntryAdded(before, after, loc, profiles) };
  });
}

export interface EstimateInput {
  date: string;
  entryId: string;
  nutrition: NutritionValues;
  notes: string | null;
  force: boolean;
}

/** The plan for an estimate, also used by the CLI's dry run. */
export function planEstimate(doc: FsDocument, input: EstimateInput): Planned {
  const loc = locateQuickAdd(doc, PROFILE, input.date, input.entryId, input.force);
  const profiles = profilesWithEstimate(doc, loc, input.nutrition, input.notes);
  return { value: profiles, check: (before, after) => onlyEntryChanged(before, after, loc, profiles) };
}

export function estimateEntry(input: EstimateInput): Promise<WriteResult> {
  return writeVerified(input.entryId, input.date, (doc) => planEstimate(doc, input));
}

export async function showDay(date: string): Promise<DayView> {
  return dayView(await readDoc(), PROFILE, date);
}

export async function searchFoods(query: string): Promise<Food[]> {
  return findFoods(await readDoc(), query);
}

export interface AddFoodInput {
  name: string;
  imageUrl: string | null;
  nutrition: FoodNutrition;
}

/** Adds a food to Foods; the result's entryId is the new food's id. */
export function addFood(input: AddFoodInput, date: string): Promise<WriteResult> {
  const id = randomUUID();
  const food = { id, name: input.name, imageUrl: input.imageUrl, nutrition: input.nutrition, createdAt: new Date().toISOString() };
  return writeVerified(id, date, (doc) => {
    const foods = foodsWithAddedFood(doc, food);
    return { field: "foods", value: foods, check: (before, after) => onlyListGrew(before, after, "foods", foods) };
  });
}

/** Changes a food in Foods the way the app's edit does; the result's entryId is the food's id. */
export function updateFood(foodId: string, patch: FoodPatch, date: string): Promise<WriteResult> {
  return writeVerified(foodId, date, (doc) => {
    const { value, replacedIndex } = foodsWithUpdatedFood(doc, foodId, patch);
    return { field: "foods", value, check: (before, after) => onlyListGrew(before, after, "foods", value, replacedIndex) };
  });
}

export interface LogFoodInput {
  date: string;
  foodId: string;
  grams: number | null;
  units: number | null;
  notes: string | null;
  section: string | null;
  planned: boolean;
}

export function logFood(input: LogFoodInput): Promise<WriteResult> {
  const id = randomUUID();
  return writeVerified(id, input.date, (doc) => {
    const food = liveFoods(doc).find((f) => f.id === input.foodId);
    if (food == null) throw new EstimateError(`No food with id ${input.foodId} in Foods.`);
    const value = foodEntryValue({ id, food, grams: input.grams, units: input.units, notes: input.notes, budgeted: input.planned });
    const { profiles, loc } = profilesWithAddedValue(doc, PROFILE, input.date, { id, value }, input.section);
    return { value: profiles, check: (before, after) => onlyEntryAdded(before, after, loc, profiles) };
  });
}

/** Deletes a day-log entry the way the app does: a tombstone the app can undo. */
export function removeEntry(date: string, entryId: string): Promise<WriteResult> {
  return writeVerified(entryId, date, (doc) => {
    const { value, replacedIndex } = tombstonesWithDeleted(doc, PROFILE, date, entryId, new Date().toISOString());
    return {
      field: "deletedDayLogEntries",
      value,
      check: (before, after) => onlyListGrew(before, after, "deletedDayLogEntries", value, replacedIndex),
    };
  });
}
