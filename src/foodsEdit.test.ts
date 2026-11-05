import { test } from "node:test";
import assert from "node:assert/strict";
import { onlyEntryAdded, profilesWithAddedValue } from "./addEntry.js";
import { dayView } from "./dayView.js";
import { EstimateError, arrayValues, mapFields, str, type FsDocument, type FsValue } from "./estimateEntry.js";
import {
  cleanImageUrl,
  findFoods,
  foodEntryValue,
  foodsWithAddedFood,
  foodsWithUpdatedFood,
  liveFoods,
  onlyListGrew,
  tombstonesWithDeleted,
  type NewFood,
} from "./foodsEdit.js";

const s = (v: string): FsValue => ({ stringValue: v });
const n = (v: number): FsValue => (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v });
const nul: FsValue = { nullValue: null };
const map = (fields: Record<string, FsValue>): FsValue => ({ mapValue: { fields } });
const arr = (values: FsValue[]): FsValue => ({ arrayValue: { values } });
const nut = (c: number, p: number, sf: number, f: number) => map({ calories: n(c), protein: n(p), saturatedFat: n(sf), fiber: n(f) });
const food = (id: string, name: string, extra: Record<string, FsValue> = {}) =>
  map({ id: s(id), name: s(name), imageUrl: nul, nutritionPer100g: nut(100, 10, 1, 2), nutritionPerUnit: nul, gramsPerUnit: nul, ingredients: nul, createdAt: s("x"), ...extra });

function doc(): FsDocument {
  return {
    name: "x",
    updateTime: "2026-11-04T14:00:00Z",
    fields: {
      foods: arr([
        food("arroz", "Arroz Lucchetti (pesado crudo)", { nutritionPer100g: nut(332, 7, 0, 2) }),
        food("yogur", "Yogurt La Serenisima", { gramsPerUnit: n(190) }),
        food("crea", "Creatina", { nutritionPerUnit: nut(0, 0, 0, 0) }),
        food("viejo", "Arroz viejo"),
      ]),
      deletedFoods: arr([map({ foodId: s("viejo"), deletedAt: s("2026-01-01T00:00:00Z") })]),
      deletedDayLogEntries: arr([
        map({ profileId: s("me"), date: s("2026-11-04"), entryId: s("back"), deletedAt: s("2026-11-04T10:00:00Z"), restoredAt: s("2026-11-04T11:00:00Z") }),
      ]),
      deletedProfiles: arr([]),
      profiles: arr([
        map({
          id: s("me"),
          name: s("Me"),
          dayLogs: arr([
            map({
              date: s("2026-11-04"),
              entries: arr([
                map({ type: s("separator"), id: s("d"), label: s("Dinner (20:30)") }),
                map({ type: s("quick-add"), id: s("q"), name: s("Arroz (50 g)"), nutrition: nut(182, 3.6, 0.1, 0.7) }),
                map({ type: s("quick-add"), id: s("back"), name: s("Restaurada"), nutrition: nut(10, 0, 0, 0) }),
                map({ type: s("separator"), id: s("p"), label: s("Dessert") }),
              ]),
            }),
          ]),
        }),
      ]),
    },
  };
}

test("findFoods matches every word, ignoring case and accents, and skips deleted foods", () => {
  assert.deepEqual(findFoods(doc(), "ARROZ crudo").map((f) => f.id), ["arroz"]);
  assert.deepEqual(findFoods(doc(), "arroz").map((f) => f.id), ["arroz"]);
  assert.deepEqual(findFoods(doc(), "serenísima").map((f) => f.id), ["yogur"]);
  assert.equal(findFoods(doc(), "").length, 3);
});

test("foodsWithAddedFood appends a food shaped like the app's, and only that changes", () => {
  const before = doc();
  const foods = foodsWithAddedFood(before, {
    id: "esp",
    name: " Espinaca congelada ",
    imageUrl: null,
    nutrition: { kind: "per100g", per100g: { calories: 29, protein: 3.6, saturatedFat: 0.1, fiber: 2.9 }, gramsPerUnit: null },
    createdAt: "2026-11-05T03:00:00Z",
  });
  const after = { ...before.fields, foods };
  assert.equal(onlyListGrew(before, after, "foods", foods), null);
  const added = { ...before, fields: after };
  const esp = liveFoods(added).find((f) => f.id === "esp");
  assert.equal(esp?.name, "Espinaca congelada");
  assert.deepEqual(esp?.nutritionPer100g, { calories: 29, protein: 3.6, saturatedFat: 0.1, fiber: 2.9 });
  assert.equal(esp?.ingredients, null);
  // A changed item elsewhere in the list is refused.
  const tampered = arrayValues(foods) ?? [];
  const bad = arr([food("arroz", "Otro"), ...tampered.slice(1)]);
  assert.notEqual(onlyListGrew(before, { ...before.fields, foods: bad }, "foods", bad), null);
});

test("foodsWithAddedFood refuses a name Foods already has", () => {
  const add = (name: string) =>
    foodsWithAddedFood(doc(), {
      id: "z",
      name,
      imageUrl: null,
      nutrition: { kind: "per100g", per100g: { calories: 1, protein: 0, saturatedFat: 0, fiber: 0 }, gramsPerUnit: null },
      createdAt: "x",
    });
  assert.throws(() => add("yogurt la serenísima"), EstimateError);
  assert.doesNotThrow(() => add("Arroz viejo")); // that one was deleted
});

test("foodEntryValue logs grams, units of a unit-sized food as grams, and unit-only foods by units", () => {
  const foods = liveFoods(doc());
  const get = (id: string) => foods.find((f) => f.id === id)!;
  const fields = (v: FsValue) => mapFields(v) ?? {};
  const g = fields(foodEntryValue({ id: "a", food: get("arroz"), grams: 50, units: null, notes: null, budgeted: false }));
  assert.deepEqual(g, { id: s("a"), foodId: s("arroz"), grams: n(50) });
  const u = fields(foodEntryValue({ id: "b", food: get("yogur"), grams: null, units: 1, notes: " rojo ", budgeted: true }));
  assert.deepEqual(u, { id: s("b"), foodId: s("yogur"), grams: n(190), notes: s("rojo"), isBudgeted: { booleanValue: true } });
  const c = fields(foodEntryValue({ id: "c", food: get("crea"), grams: null, units: 5, notes: null, budgeted: false }));
  assert.deepEqual(c, { id: s("c"), foodId: s("crea"), grams: n(0), units: n(5) });
  assert.throws(() => foodEntryValue({ id: "d", food: get("arroz"), grams: null, units: 1, notes: null, budgeted: false }), EstimateError);
  assert.throws(() => foodEntryValue({ id: "d", food: get("crea"), grams: 10, units: null, notes: null, budgeted: false }), EstimateError);
  assert.throws(() => foodEntryValue({ id: "d", food: get("arroz"), grams: 10, units: 1, notes: null, budgeted: false }), EstimateError);
});

test("a logged food lands at the end of its section and counts in the day", () => {
  const before = doc();
  const food = liveFoods(before).find((f) => f.id === "arroz")!;
  const value = foodEntryValue({ id: "new", food, grams: 50, units: null, notes: null, budgeted: false });
  const { profiles, loc } = profilesWithAddedValue(before, "Me", "2026-11-04", { id: "new", value }, "dinner");
  assert.equal(onlyEntryAdded(before, { ...before.fields, profiles }, loc, profiles), null);
  const day = dayView({ ...before, fields: { ...before.fields, profiles } }, "Me", "2026-11-04");
  const added = day.entries.find((e) => e.id === "new");
  assert.equal(added?.section, "Dinner (20:30)");
  assert.equal(added?.amount, "50 g");
  assert.equal(added?.nutrition?.calories, 166);
});

test("tombstonesWithDeleted adds a tombstone the day view honours, and only that changes", () => {
  const before = doc();
  const { value, replacedIndex } = tombstonesWithDeleted(before, "Me", "2026-11-04", "q", "2026-11-05T03:00:00Z");
  assert.equal(replacedIndex, null);
  const after = { ...before.fields, deletedDayLogEntries: value };
  assert.equal(onlyListGrew(before, after, "deletedDayLogEntries", value, replacedIndex), null);
  const list = arrayValues(value) ?? [];
  const last = mapFields(list[list.length - 1]) ?? {};
  assert.deepEqual(last, { profileId: s("me"), date: s("2026-11-04"), entryId: s("q"), deletedAt: s("2026-11-05T03:00:00Z") });
  const day = dayView({ ...before, fields: after }, "Me", "2026-11-04");
  assert.equal(day.entries.some((e) => e.id === "q"), false);
});

test("tombstonesWithDeleted renews a restored tombstone and refuses a missing or deleted entry", () => {
  const before = doc();
  const { value, replacedIndex } = tombstonesWithDeleted(before, "Me", "2026-11-04", "back", "2026-11-05T03:00:00Z");
  assert.equal(replacedIndex, 0);
  assert.equal(onlyListGrew(before, { ...before.fields, deletedDayLogEntries: value }, "deletedDayLogEntries", value, 0), null);
  assert.equal(str(mapFields((arrayValues(value) ?? [])[0])?.deletedAt), "2026-11-05T03:00:00Z");
  assert.throws(() => tombstonesWithDeleted(before, "Me", "2026-11-04", "nope", "t"), EstimateError);
  const deleted = { ...before, fields: { ...before.fields, deletedDayLogEntries: value } };
  assert.throws(() => tombstonesWithDeleted(deleted, "Me", "2026-11-04", "back", "2026-11-05T04:00:00Z"), EstimateError);
});

const withFoods = (before: FsDocument, foods: FsValue): FsDocument => ({ ...before, fields: { ...before.fields, foods } });
const newFood = (id: string, name: string, nutrition: NewFood["nutrition"], imageUrl: string | null = null): NewFood => ({
  id,
  name,
  imageUrl,
  nutrition,
  createdAt: "2026-11-05T03:00:00Z",
});

test("foodsWithAddedFood stores an image and a unit-only food the way the Food form does", () => {
  const before = doc();
  const foods = foodsWithAddedFood(
    before,
    newFood("whey", "Whey (scoop)", { kind: "perUnit", perUnit: { calories: 120, protein: 24, saturatedFat: 1, fiber: 0 } }, "https://x.test/w.jpg"),
  );
  assert.equal(onlyListGrew(before, { ...before.fields, foods }, "foods", foods), null);
  const whey = liveFoods(withFoods(before, foods)).find((f) => f.id === "whey");
  assert.equal(whey?.imageUrl, "https://x.test/w.jpg");
  assert.deepEqual(whey?.nutritionPerUnit, { calories: 120, protein: 24, saturatedFat: 1, fiber: 0 });
  assert.deepEqual(whey?.nutritionPer100g, { calories: 0, protein: 0, saturatedFat: 0, fiber: 0 });
  assert.equal(whey?.gramsPerUnit, null);
});

test("a combo gets its nutrition per 100 g and unit size from its ingredients, and logs like the app's", () => {
  const before = doc();
  const foods = foodsWithAddedFood(
    before,
    newFood("mix", "Yogur con arroz", { kind: "combo", ingredients: [{ foodId: "yogur", grams: 190 }, { foodId: "arroz", grams: 10 }] }),
  );
  const after = withFoods(before, foods);
  const mix = liveFoods(after).find((f) => f.id === "mix")!;
  assert.deepEqual(mix.ingredients, [{ foodId: "yogur", grams: 190 }, { foodId: "arroz", grams: 10 }]);
  assert.equal(mix.gramsPerUnit, 200);
  // 190 g at 100 kcal/100 g + 10 g at 332 kcal/100 g = 223.2 kcal in 200 g.
  assert.equal(mix.nutritionPer100g.calories, 111.6);
  const value = foodEntryValue({ id: "e", food: mix, grams: null, units: 1, notes: null, budgeted: false });
  const { profiles } = profilesWithAddedValue(after, "Me", "2026-11-04", { id: "e", value }, "dinner");
  const day = dayView({ ...after, fields: { ...after.fields, profiles } }, "Me", "2026-11-04");
  assert.equal(day.entries.find((e) => e.id === "e")?.nutrition?.calories, 223.2);
});

test("a combo refuses unit-only, missing and deleted ingredients, and no ingredients", () => {
  const add = (ingredients: { foodId: string; grams: number }[]) =>
    foodsWithAddedFood(doc(), newFood("mix", "Mix", { kind: "combo", ingredients }));
  assert.throws(() => add([{ foodId: "crea", grams: 5 }]), EstimateError);
  assert.throws(() => add([{ foodId: "nope", grams: 5 }]), EstimateError);
  assert.throws(() => add([{ foodId: "viejo", grams: 5 }]), EstimateError);
  assert.throws(() => add([{ foodId: "arroz", grams: 0 }]), EstimateError);
  assert.throws(() => add([]), EstimateError);
});

test("foodsWithUpdatedFood changes only the given fields of one food, in place", () => {
  const before = doc();
  const { value, replacedIndex } = foodsWithUpdatedFood(before, "yogur", { imageUrl: "https://x.test/y.png" });
  assert.equal(replacedIndex, 1);
  assert.equal(onlyListGrew(before, { ...before.fields, foods: value }, "foods", value, replacedIndex), null);
  const old = liveFoods(before).find((f) => f.id === "yogur")!;
  const now = liveFoods(withFoods(before, value)).find((f) => f.id === "yogur")!;
  assert.deepEqual(now, { ...old, imageUrl: "https://x.test/y.png" });
  const cleared = foodsWithUpdatedFood(withFoods(before, value), "yogur", { imageUrl: null });
  assert.equal(liveFoods(withFoods(before, cleared.value)).find((f) => f.id === "yogur")?.imageUrl, null);
  // Same image again: nothing to change.
  assert.throws(() => foodsWithUpdatedFood(withFoods(before, value), "yogur", { imageUrl: "https://x.test/y.png" }), EstimateError);
});

test("foodsWithUpdatedFood refuses a deleted food, a taken name and a combo that would contain itself", () => {
  const before = doc();
  assert.throws(() => foodsWithUpdatedFood(before, "viejo", { name: "Nuevo" }), EstimateError);
  assert.throws(() => foodsWithUpdatedFood(before, "arroz", { name: "yogurt la serenisima" }), EstimateError);
  assert.doesNotThrow(() => foodsWithUpdatedFood(before, "arroz", { name: "ARROZ LUCCHETTI (pesado crudo) " }));
  const withMix = withFoods(
    before,
    foodsWithAddedFood(before, newFood("mix", "Mix", { kind: "combo", ingredients: [{ foodId: "arroz", grams: 50 }] })),
  );
  assert.throws(() => foodsWithUpdatedFood(withMix, "arroz", { nutrition: { kind: "combo", ingredients: [{ foodId: "mix", grams: 10 }] } }), EstimateError);
  assert.throws(() => foodsWithUpdatedFood(withMix, "mix", { nutrition: { kind: "combo", ingredients: [{ foodId: "mix", grams: 10 }] } }), EstimateError);
  const regrown = foodsWithUpdatedFood(withMix, "mix", { nutrition: { kind: "combo", ingredients: [{ foodId: "arroz", grams: 100 }] } });
  assert.equal(liveFoods(withFoods(withMix, regrown.value)).find((f) => f.id === "mix")?.gramsPerUnit, 100);
});

test("cleanImageUrl takes http(s) URLs, trims them, and turns empty into null", () => {
  assert.equal(cleanImageUrl("  https://x.test/a.jpg "), "https://x.test/a.jpg");
  assert.equal(cleanImageUrl(""), null);
  assert.equal(cleanImageUrl(null), null);
  assert.throws(() => cleanImageUrl("javascript:alert(1)"), EstimateError);
  assert.throws(() => cleanImageUrl("not a url"), EstimateError);
});
