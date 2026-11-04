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
import type { NutritionValues } from "../src/types.js";
import { onlyEntryAdded, profilesWithAddedEntry } from "../src/addEntry.js";
import { dayView, type DayView } from "../src/dayView.js";
import {
  EstimateError,
  locateQuickAdd,
  onlyEntryChanged,
  profilesWithEstimate,
  type FsDocument,
  type FsValue,
} from "../src/estimateEntry.js";
import { PROFILE, StaleDocumentError, backupDoc, readDoc, writeProfiles } from "./firestore.js";

export interface WriteResult {
  entryId: string;
  backup: string;
  day: DayView;
}

interface Planned {
  profiles: FsValue;
  /** Null when `after` is exactly `before` plus the planned change. */
  check: (before: FsDocument, after: Record<string, FsValue>) => string | null;
}

async function writeVerified(entryId: string, date: string, plan: (doc: FsDocument) => Planned): Promise<WriteResult> {
  for (let attempt = 1; ; attempt++) {
    const doc = await readDoc();
    const planned = plan(doc);
    const problem = planned.check(doc, { ...doc.fields, profiles: planned.profiles });
    if (problem != null) throw new EstimateError(`Refusing to write: ${problem}`);
    const backup = backupDoc(doc);
    let stored: FsDocument;
    try {
      stored = await writeProfiles(doc, planned.profiles);
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
    return { profiles, check: (before, after) => onlyEntryAdded(before, after, loc, profiles) };
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
  return { profiles, check: (before, after) => onlyEntryChanged(before, after, loc, profiles) };
}

export function estimateEntry(input: EstimateInput): Promise<WriteResult> {
  return writeVerified(input.entryId, input.date, (doc) => planEstimate(doc, input));
}

export async function showDay(date: string): Promise<DayView> {
  return dayView(await readDoc(), PROFILE, date);
}
