import type { DayLogItem, NutritionValues } from "./types.js";
import { appDataFromRaw } from "./cloudDoc.js";
import { EstimateError, deletedEntryIds, type FsDocument, type FsValue } from "./estimateEntry.js";
import { buildResolvedFoodsMap, nutritionForEntry, sumNutrition } from "./nutrition.js";

/**
 * A day of the log as a plain summary, for the MCP server to show: each live
 * entry with its section and nutrition, and the day's totals against the
 * profile's goals. Read-only: the decoded values never go back to Firestore.
 */

/** A Firestore REST value as plain JSON. */
export function fsToJs(value: FsValue): unknown {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(fsToJs);
  return Object.fromEntries(Object.entries(value.mapValue.fields ?? {}).map(([k, v]) => [k, fsToJs(v)]));
}

export interface DayViewEntry {
  id: string;
  kind: "food" | "quick-add";
  section: string | null;
  name: string;
  amount: string | null;
  nutrition: NutritionValues | null;
  /** Planned ("budgeted"), not eaten yet. */
  planned: boolean;
  notes: string | null;
}

export interface DayView {
  date: string;
  profile: string;
  sections: string[];
  entries: DayViewEntry[];
  eaten: NutritionValues;
  planned: NutritionValues;
  goals: NutritionValues | null;
  signedOff: string | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const rounded = (v: NutritionValues): NutritionValues => ({
  calories: round1(v.calories),
  protein: round1(v.protein),
  saturatedFat: round1(v.saturatedFat),
  fiber: round1(v.fiber),
});

export function dayView(doc: FsDocument, profileName: string, date: string): DayView {
  const raw = Object.fromEntries(Object.entries(doc.fields).map(([k, v]) => [k, fsToJs(v)]));
  const data = appDataFromRaw(raw);
  const profile = data.profiles.find((p) => p.name === profileName);
  if (profile == null) throw new EstimateError(`No profile named "${profileName}".`);
  const day = profile.dayLogs.find((d) => d.date === date);
  const deleted = deletedEntryIds(doc, profile.id, date);
  const items: DayLogItem[] = (day?.entries ?? []).filter((e) => !deleted.has(e.id));
  const foods = buildResolvedFoodsMap(data.foods);

  const sections: string[] = [];
  const entries: DayViewEntry[] = [];
  let section: string | null = null;
  for (const item of items) {
    if (item.type === "separator") {
      section = item.label;
      sections.push(item.label);
      continue;
    }
    if (item.type === "quick-add") {
      entries.push({
        id: item.id,
        kind: "quick-add",
        section,
        name: item.name,
        amount: null,
        nutrition: rounded(item.nutrition),
        planned: item.isBudgeted === true,
        notes: item.notes ?? null,
      });
      continue;
    }
    const food = foods.get(item.foodId);
    entries.push({
      id: item.id,
      kind: "food",
      section,
      name: food?.name ?? `(missing food ${item.foodId})`,
      amount: item.units != null ? `${item.units} u` : `${item.grams} g`,
      nutrition: food != null ? rounded(nutritionForEntry(item, food)) : null,
      planned: item.isBudgeted === true,
      notes: item.notes ?? null,
    });
  }

  const g = profile.goals;
  const goals =
    g == null
      ? null
      : {
          calories: g.calories,
          protein: g.protein,
          saturatedFat: g.saturatedFatMode === "percentage" ? round1((g.calories * g.saturatedFat) / 100 / 9) : g.saturatedFat,
          fiber: g.fiber,
        };
  return {
    date,
    profile: profileName,
    sections,
    entries,
    eaten: rounded(sumNutrition(items, foods, { status: "consumed" })),
    planned: rounded(sumNutrition(items, foods, { status: "budgeted" })),
    goals,
    signedOff: day?.signOff != null ? day.signOff.trust : null,
  };
}
