import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cloneItemsWithNewIds,
  collectSelectedItems,
  describeRowCount,
  getDuplicateInsertIndex,
  getEntryClipboard,
  getPasteInsertIndex,
  insertItemsAt,
  selectInsertedItems,
  setEntryClipboard,
  withoutUnknownFoods,
} from "./entryClipboard.js";
import { emptyEntrySelection, selectEntry } from "./dailyLogKeyboard.js";
import type { DayLogItem, FoodId, LogEntryId } from "../types.js";

function id(value: string): LogEntryId {
  return value as LogEntryId;
}

function entry(value: string, isBudgeted?: boolean): DayLogItem {
  return {
    id: id(value),
    foodId: `food-${value}` as FoodId,
    grams: 100,
    isBudgeted,
  };
}

function quick(value: string): DayLogItem {
  return {
    type: "quick-add",
    id: id(value),
    name: `quick-${value}`,
    nutrition: { calories: 100, protein: 10, saturatedFat: 1, fiber: 2 },
  };
}

function separator(value: string): DayLogItem {
  return { type: "separator", id: id(value), label: `section-${value}` };
}

function counterIds(): () => string {
  let next = 0;
  return () => `new-${++next}`;
}

const itemIds = (items: ReadonlyArray<DayLogItem>) => items.map((item) => item.id);

describe("collectSelectedItems", () => {
  const items = [separator("s1"), entry("a"), quick("b"), separator("s2"), entry("c")];

  it("takes the selected rows in list order, whatever order they were selected in", () => {
    assert.deepEqual(
      itemIds(collectSelectedItems(items, [id("c"), id("a")], new Set())),
      ["a", "c"],
    );
  });

  it("takes a collapsed section's hidden rows along with its header", () => {
    assert.deepEqual(
      itemIds(collectSelectedItems(items, [id("s1")], new Set([id("s1")]))),
      ["s1", "a", "b"],
    );
  });

  it("takes only the header of a section that is open", () => {
    assert.deepEqual(
      itemIds(collectSelectedItems(items, [id("s1")], new Set())),
      ["s1"],
    );
  });

  it("does not take a collapsed section that is not selected", () => {
    assert.deepEqual(
      itemIds(collectSelectedItems(items, [id("c")], new Set([id("s1"), id("s2")]))),
      ["c"],
    );
  });
});

describe("cloneItemsWithNewIds", () => {
  it("gives every copy a new id and keeps the rest of the row", () => {
    const source = [entry("a", true), quick("b"), separator("s")];
    const clones = cloneItemsWithNewIds(source, counterIds());
    assert.deepEqual(itemIds(clones), ["new-1", "new-2", "new-3"]);
    assert.deepEqual({ ...clones[0], id: id("a") }, source[0]);
    assert.deepEqual({ ...clones[1], id: id("b") }, source[1]);
    assert.deepEqual({ ...clones[2], id: id("s") }, source[2]);
  });
});

describe("withoutUnknownFoods", () => {
  it("drops entries whose food is gone and keeps quick adds and sections", () => {
    const items = [entry("a"), entry("gone"), quick("q"), separator("s")];
    const kept = withoutUnknownFoods(items, (foodId) => foodId !== "food-gone");
    assert.deepEqual(itemIds(kept), ["a", "q", "s"]);
  });
});

describe("insert positions", () => {
  const items = [entry("a"), entry("b"), entry("c")];

  it("pastes right below the focused row", () => {
    assert.equal(getPasteInsertIndex(items, selectEntry(id("a"), itemIds(items))), 1);
  });

  it("pastes at the end with nothing focused", () => {
    assert.equal(getPasteInsertIndex(items, emptyEntrySelection), 3);
    assert.equal(getPasteInsertIndex([], emptyEntrySelection), 0);
  });

  it("pastes at the end when the focused row is no longer there", () => {
    assert.equal(getPasteInsertIndex(items, selectEntry(id("x"), [id("x")])), 3);
  });

  it("duplicates right below the last copied row", () => {
    assert.equal(getDuplicateInsertIndex(items, [entry("a"), entry("b")]), 2);
    assert.equal(getDuplicateInsertIndex(items, [entry("c")]), 3);
  });

  it("inserts the rows together, clamping the index", () => {
    const added = [entry("x"), entry("y")];
    assert.deepEqual(itemIds(insertItemsAt(items, added, 1)), ["a", "x", "y", "b", "c"]);
    assert.deepEqual(itemIds(insertItemsAt(items, added, 99)), ["a", "b", "c", "x", "y"]);
    assert.deepEqual(itemIds(insertItemsAt(items, added, -1)), ["x", "y", "a", "b", "c"]);
  });
});

describe("selectInsertedItems", () => {
  it("selects the new rows and focuses the last one", () => {
    assert.deepEqual(selectInsertedItems([entry("x"), entry("y")]), {
      focusedId: id("y"),
      anchorId: id("x"),
      selectedIds: [id("x"), id("y")],
    });
  });

  it("selects nothing when nothing was inserted", () => {
    assert.equal(selectInsertedItems([]), null);
  });
});

describe("the clipboard", () => {
  it("keeps its own copy, untouched by later edits to the source rows", () => {
    const row = { id: id("a"), foodId: "food-a" as FoodId, grams: 100 };
    setEntryClipboard([row]);
    row.grams = 5;
    assert.deepEqual(getEntryClipboard(), [{ id: id("a"), foodId: "food-a", grams: 100 }]);
  });
});

describe("describeRowCount", () => {
  it("counts rows in singular and plural", () => {
    assert.equal(describeRowCount(1), "1 row");
    assert.equal(describeRowCount(3), "3 rows");
  });
});
