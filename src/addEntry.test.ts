import { test } from "node:test";
import assert from "node:assert/strict";
import { onlyEntryAdded, profilesWithAddedEntry, type NewQuickAdd } from "./addEntry.js";
import { EstimateError, arrayValues, mapFields, str, type FsDocument, type FsValue } from "./estimateEntry.js";

const s = (v: string): FsValue => ({ stringValue: v });
const map = (fields: Record<string, FsValue>): FsValue => ({ mapValue: { fields } });
const arr = (values: FsValue[]): FsValue => ({ arrayValue: { values } });
const sep = (id: string, label: string) => map({ type: s("separator"), id: s(id), label: s(label) });
const food = (id: string) => map({ id: s(id), foodId: s("f1"), grams: { doubleValue: 200.0 } });

function doc(): FsDocument {
  return {
    name: "projects/p/databases/(default)/documents/users/u/data/appData",
    updateTime: "2026-11-04T14:00:00Z",
    fields: {
      activeProfileId: s("me"),
      foods: arr([map({ id: s("f1"), name: s("Brócoli"), weird: { doubleValue: 5 } })]),
      deletedDayLogEntries: arr([
        map({ profileId: s("me"), date: s("2026-11-04"), entryId: s("old-lunch"), deletedAt: s("2026-11-04T10:00:00Z") }),
      ]),
      profiles: arr([
        map({ id: s("other"), name: s("Marisol"), dayLogs: arr([]) }),
        map({
          id: s("me"),
          name: s("Me"),
          dayLogs: arr([
            map({ date: s("2026-11-03"), entries: arr([food("y1")]), weightKg: { doubleValue: 80.5 } }),
            map({
              date: s("2026-11-04"),
              entries: arr([
                sep("b", "Breakfast (07:00)"),
                food("e1"),
                sep("old-lunch", "Almuerzo viejo"),
                sep("l", "LUNCH (12:30)"),
                food("e2"),
                sep("d", "Dinner (20:30)"),
                sep("d2", "Dinner #2"),
              ]),
            }),
          ]),
        }),
      ]),
    },
  };
}

const meal = (over: Partial<NewQuickAdd> = {}): NewQuickAdd => ({
  id: "new",
  name: "  Empanadas x2 (180 g) ",
  nutrition: { calories: 512.36, protein: 20, saturatedFat: 8.04, fiber: 3 },
  notes: null,
  budgeted: false,
  ...over,
});

function dayEntries(profiles: FsValue, date: string): FsValue[] {
  const me = (arrayValues(profiles) ?? []).map((p) => mapFields(p) ?? {}).find((p) => str(p.name) === "Me") ?? {};
  const day = (arrayValues(me.dayLogs) ?? []).map((d) => mapFields(d) ?? {}).find((d) => str(d.date) === date) ?? {};
  return arrayValues(day.entries) ?? [];
}
const ids = (entries: FsValue[]) => entries.map((e) => str(mapFields(e)?.id));

test("adds at the end of the day without a section", () => {
  const d = doc();
  const { profiles, loc } = profilesWithAddedEntry(d, "Me", "2026-11-04", meal(), null);
  assert.deepEqual(ids(dayEntries(profiles, "2026-11-04")), ["b", "e1", "old-lunch", "l", "e2", "d", "d2", "new"]);
  assert.equal(onlyEntryAdded(d, { ...d.fields, profiles }, loc, profiles), null);
});

test("adds at the end of the matching section, ignoring case and accents", () => {
  const d = doc();
  const { profiles, loc } = profilesWithAddedEntry(d, "Me", "2026-11-04", meal(), "lunch");
  assert.deepEqual(ids(dayEntries(profiles, "2026-11-04")), ["b", "e1", "old-lunch", "l", "e2", "new", "d", "d2"]);
  assert.equal(onlyEntryAdded(d, { ...d.fields, profiles }, loc, profiles), null);
  const b = profilesWithAddedEntry(d, "Me", "2026-11-04", meal(), "BREAKFAST (07:00)");
  // A deleted separator does not end the section: the entry goes before LUNCH.
  assert.deepEqual(ids(dayEntries(b.profiles, "2026-11-04")), ["b", "e1", "old-lunch", "new", "l", "e2", "d", "d2"]);
});

test("an exact label wins over labels that only contain it; ambiguity and no match refuse", () => {
  const d = doc();
  const exact = profilesWithAddedEntry(d, "Me", "2026-11-04", meal(), "dinner (20:30)");
  assert.deepEqual(ids(dayEntries(exact.profiles, "2026-11-04")).slice(-3), ["d", "new", "d2"]);
  assert.throws(() => profilesWithAddedEntry(d, "Me", "2026-11-04", meal(), "dinner"), /More than one section/);
  assert.throws(() => profilesWithAddedEntry(d, "Me", "2026-11-04", meal(), "Merienda"), /No section matches.*LUNCH/);
  assert.throws(() => profilesWithAddedEntry(d, "Me", "2026-11-04", meal(), "almuerzo viejo"), EstimateError);
});

test("a date with no log gets a new day holding only the entry", () => {
  const d = doc();
  const { profiles, loc } = profilesWithAddedEntry(d, "Me", "2026-11-05", meal(), null);
  assert.equal(loc.newDay, true);
  assert.deepEqual(ids(dayEntries(profiles, "2026-11-05")), ["new"]);
  assert.equal(onlyEntryAdded(d, { ...d.fields, profiles }, loc, profiles), null);
  assert.throws(() => profilesWithAddedEntry(d, "Me", "2026-11-05", meal(), "Lunch"), /no sections/);
});

test("the entry is shaped like the app's quick-add", () => {
  const { profiles } = profilesWithAddedEntry(doc(), "Me", "2026-11-04", meal({ notes: " 2 al horno ", budgeted: true }), null);
  const entries = dayEntries(profiles, "2026-11-04");
  const entry = entries[entries.length - 1];
  assert.deepEqual(entry, map({
    type: s("quick-add"),
    id: s("new"),
    name: s("Empanadas x2 (180 g)"),
    nutrition: map({
      calories: { doubleValue: 512.4 },
      protein: { integerValue: "20" },
      saturatedFat: { integerValue: "8" },
      fiber: { integerValue: "3" },
    }),
    notes: s("2 al horno"),
    isBudgeted: { booleanValue: true },
  }));
});

test("refuses bad input", () => {
  const d = doc();
  assert.throws(() => profilesWithAddedEntry(d, "Me", "2026-11-04", meal({ name: "  " }), null), /needs a name/);
  assert.throws(
    () => profilesWithAddedEntry(d, "Me", "2026-11-04", meal({ nutrition: { calories: -1, protein: 0, saturatedFat: 0, fiber: 0 } }), null),
    /Not a valid amount/,
  );
  assert.throws(() => profilesWithAddedEntry(d, "Me", "4/11", meal(), null), /Not a date/);
  assert.throws(() => profilesWithAddedEntry(d, "Nadie", "2026-11-04", meal(), null), /No profile/);
  assert.throws(() => profilesWithAddedEntry(d, "Me", "2026-11-04", meal({ id: "e1" }), null), /already has an entry/);
});

test("onlyEntryAdded catches any other change", () => {
  const d = doc();
  const { profiles, loc } = profilesWithAddedEntry(d, "Me", "2026-11-04", meal(), "lunch");
  assert.match(onlyEntryAdded(d, { ...d.fields, profiles, foods: arr([]) }, loc, profiles) ?? "", /Field "foods"/);
  const twice = profilesWithAddedEntry({ ...d, fields: { ...d.fields, profiles } }, "Me", "2026-11-03", meal({ id: "x" }), null);
  assert.match(onlyEntryAdded(d, { ...d.fields, profiles: twice.profiles }, loc, twice.profiles) ?? "", /besides the new entry/);
  assert.match(onlyEntryAdded(d, { ...d.fields, profiles: d.fields.profiles }, loc, profiles) ?? "", /not the ones sent/);
});
