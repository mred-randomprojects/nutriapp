import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EstimateError,
  listDay,
  locateQuickAdd,
  onlyEntryChanged,
  profilesWithEstimate,
  type FsDocument,
  type FsValue,
} from "./estimateEntry.js";

const s = (v: string): FsValue => ({ stringValue: v });
const map = (fields: Record<string, FsValue>): FsValue => ({ mapValue: { fields } });
const arr = (values: FsValue[]): FsValue => ({ arrayValue: { values } });
const zero = map({
  calories: { integerValue: "0" },
  protein: { integerValue: "0" },
  saturatedFat: { integerValue: "0" },
  fiber: { integerValue: "0" },
});

function doc(): FsDocument {
  const day = (date: string, entries: FsValue[]) => map({ date: s(date), entries: arr(entries) });
  return {
    name: "projects/p/databases/(default)/documents/users/u/data/appData",
    updateTime: "2026-10-23T14:00:00Z",
    fields: {
      activeProfileId: s("me"),
      foods: arr([map({ id: s("f1"), name: s("Brócoli"), weird: { doubleValue: 5 } })]),
      deletedDayLogEntries: arr([
        map({ profileId: s("me"), date: s("2026-10-22"), entryId: s("gone"), deletedAt: s("2026-10-22T10:00:00Z") }),
      ]),
      profiles: arr([
        map({
          id: s("me"),
          name: s("Me"),
          dayLogs: arr([
            day("2026-10-21", [map({ type: s("quick-add"), id: s("same-id-other-day"), name: s("x"), nutrition: zero })]),
            day("2026-10-22", [
              map({ type: s("separator"), id: s("sep"), label: s("Cena") }),
              map({ id: s("e1"), foodId: s("f1"), grams: { doubleValue: 200.0 } }),
              map({ type: s("quick-add"), id: s("burger"), name: s("Hamburguesas"), nutrition: zero }),
              map({ type: s("quick-add"), id: s("gone"), name: s("Borrada"), nutrition: zero }),
              map({
                type: s("quick-add"),
                id: s("done"),
                name: s("Ya estimada"),
                nutrition: map({ calories: { integerValue: "300" } }),
              }),
            ]),
          ]),
        }),
        map({ id: s("other"), name: s("Marisol"), dayLogs: arr([]) }),
      ]),
    },
  };
}

const est = { calories: 1300, protein: 52, saturatedFat: 21.5, fiber: 6 };

test("lists the day without deleted entries", () => {
  const ids = listDay(doc(), "Me", "2026-10-22").map((e) => e.id);
  assert.deepEqual(ids, ["sep", "e1", "burger", "done"]);
});

test("refuses entries that are not a live, unestimated quick-add", () => {
  const d = doc();
  assert.throws(() => locateQuickAdd(d, "Me", "2026-10-22", "e1", false), EstimateError);
  assert.throws(() => locateQuickAdd(d, "Me", "2026-10-22", "gone", false), EstimateError);
  assert.throws(() => locateQuickAdd(d, "Me", "2026-10-22", "done", false), EstimateError);
  assert.throws(() => locateQuickAdd(d, "Me", "2026-10-22", "nope", false), EstimateError);
  assert.throws(() => locateQuickAdd(d, "Marisol", "2026-10-22", "burger", false), EstimateError);
  assert.deepEqual(locateQuickAdd(d, "Me", "2026-10-22", "done", true), { profileIndex: 0, dayIndex: 1, entryIndex: 4 });
});

test("changes only the entry's nutrition and notes, and keeps every other value as stored", () => {
  const d = doc();
  const before = JSON.stringify(d);
  const loc = locateQuickAdd(d, "Me", "2026-10-22", "burger", false);
  const profiles = profilesWithEstimate(d, loc, est, "Estimado por Claude");
  assert.equal(JSON.stringify(d), before, "the input document is not mutated");
  assert.equal(onlyEntryChanged(d, { ...d.fields, profiles }, loc, profiles), null);
  const entry = listDay({ ...d, fields: { ...d.fields, profiles } }, "Me", "2026-10-22").find((e) => e.id === "burger");
  assert.equal(entry?.calories, 1300);
  // 200.0 stays a doubleValue, not re-encoded as an integer:
  assert.match(JSON.stringify(profiles), /"grams":\{"doubleValue":200\}/);
  assert.match(JSON.stringify(profiles), /"saturatedFat":\{"doubleValue":21.5\}/);
});

test("catches any other change", () => {
  const d = doc();
  const loc = locateQuickAdd(d, "Me", "2026-10-22", "burger", false);
  const profiles = profilesWithEstimate(d, loc, est, null);
  assert.notEqual(onlyEntryChanged(d, { ...d.fields, profiles, activeProfileId: s("other") }, loc, profiles), null);
  const otherLoc = locateQuickAdd(d, "Me", "2026-10-21", "same-id-other-day", false);
  const elsewhere = profilesWithEstimate(d, otherLoc, est, null);
  assert.notEqual(onlyEntryChanged(d, { ...d.fields, profiles: elsewhere }, loc, elsewhere), null);
  assert.notEqual(onlyEntryChanged(d, { ...d.fields, profiles: elsewhere }, loc, profiles), null);
});

test("rejects impossible amounts", () => {
  const d = doc();
  const loc = locateQuickAdd(d, "Me", "2026-10-22", "burger", false);
  assert.throws(() => profilesWithEstimate(d, loc, { ...est, calories: -1 }, null), EstimateError);
  assert.throws(() => profilesWithEstimate(d, loc, { ...est, protein: Number.NaN }, null), EstimateError);
});
