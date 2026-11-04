import { test } from "node:test";
import assert from "node:assert/strict";
import { dayView } from "./dayView.js";
import type { FsDocument, FsValue } from "./estimateEntry.js";

const s = (v: string): FsValue => ({ stringValue: v });
const n = (v: number): FsValue => (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v });
const map = (fields: Record<string, FsValue>): FsValue => ({ mapValue: { fields } });
const arr = (values: FsValue[]): FsValue => ({ arrayValue: { values } });
const nut = (c: number, p: number, sf: number, f: number) => map({ calories: n(c), protein: n(p), saturatedFat: n(sf), fiber: n(f) });

const doc: FsDocument = {
  name: "x",
  updateTime: "2026-11-04T14:00:00Z",
  fields: {
    foods: arr([
      map({ id: s("pollo"), name: s("Pollo"), imageUrl: { nullValue: null }, nutritionPer100g: nut(165, 31, 1, 0), nutritionPerUnit: { nullValue: null }, gramsPerUnit: { nullValue: null }, ingredients: { nullValue: null }, createdAt: s("x") }),
    ]),
    deletedDayLogEntries: arr([map({ profileId: s("me"), date: s("2026-11-04"), entryId: s("gone"), deletedAt: s("2026-11-04T10:00:00Z") })]),
    deletedFoods: arr([]),
    deletedProfiles: arr([]),
    profiles: arr([
      map({
        id: s("me"),
        name: s("Me"),
        goals: map({ calories: n(2000), protein: n(150), saturatedFat: n(9), saturatedFatMode: s("percentage"), fiber: n(30) }),
        dayLogs: arr([
          map({
            date: s("2026-11-04"),
            entries: arr([
              map({ type: s("separator"), id: s("l"), label: s("LUNCH") }),
              map({ id: s("e1"), foodId: s("pollo"), grams: n(200) }),
              map({ type: s("quick-add"), id: s("q"), name: s("Ensalada"), nutrition: nut(350, 10, 4.5, 6), notes: s("250 g") }),
              map({ type: s("quick-add"), id: s("gone"), name: s("Borrada"), nutrition: nut(999, 0, 0, 0) }),
              map({ type: s("separator"), id: s("d"), label: s("Dinner") }),
              map({ type: s("quick-add"), id: s("plan"), name: s("Yogur"), nutrition: nut(120, 10, 1, 0), isBudgeted: { booleanValue: true } }),
            ]),
          }),
        ]),
      }),
    ]),
  },
};

test("a day's entries, sections and totals, without deleted entries", () => {
  const v = dayView(doc, "Me", "2026-11-04");
  assert.deepEqual(v.sections, ["LUNCH", "Dinner"]);
  assert.deepEqual(v.entries.map((e) => [e.id, e.section, e.amount, e.planned]), [
    ["e1", "LUNCH", "200 g", false],
    ["q", "LUNCH", null, false],
    ["plan", "Dinner", null, true],
  ]);
  assert.deepEqual(v.entries[0].nutrition, { calories: 330, protein: 62, saturatedFat: 2, fiber: 0 });
  assert.deepEqual(v.eaten, { calories: 680, protein: 72, saturatedFat: 6.5, fiber: 6 });
  assert.deepEqual(v.planned, { calories: 120, protein: 10, saturatedFat: 1, fiber: 0 });
  // 9% of 2000 kcal, in grams of fat (9 kcal/g).
  assert.deepEqual(v.goals, { calories: 2000, protein: 150, saturatedFat: 20, fiber: 30 });
});

test("a day with nothing logged is empty, not an error", () => {
  const v = dayView(doc, "Me", "2026-11-05");
  assert.deepEqual(v.entries, []);
  assert.equal(v.eaten.calories, 0);
});
