import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canRepeatDailyLogKeyboardAction,
  emptyEntrySelection,
  getAddBelowIndexForSelection,
  getDailyLogKeyboardAction,
  getDeleteSelectionDescription,
  getKeyboardAddEntryInsertIndex,
  getVisibleEntryIds,
  moveEntrySelection,
  moveSelectedItems,
  normalizeEntrySelection,
  selectAfterRemovingEntries,
  selectEntry,
  toggleBudgetedForSelectedItems,
  type EntrySelectionState,
} from "./dailyLogKeyboard.js";
import type {
  DayLogItem,
  FoodId,
  LogEntryId,
  NutritionValues,
} from "../types.js";

function id(value: string): LogEntryId {
  return value as LogEntryId;
}

function foodId(value: string): FoodId {
  return value as FoodId;
}

const ids = [id("a"), id("b"), id("c"), id("d")];

function selectedIds(selection: EntrySelectionState): string[] {
  return selection.selectedIds;
}

function entry(value: string, isBudgeted?: boolean): DayLogItem {
  return {
    id: id(value),
    foodId: foodId(`food-${value}`),
    grams: 100,
    isBudgeted,
  };
}

function quick(value: string, isBudgeted?: boolean): DayLogItem {
  const nutrition: NutritionValues = {
    calories: 100,
    protein: 10,
    saturatedFat: 1,
    fiber: 2,
  };
  return {
    type: "quick-add",
    id: id(value),
    name: `quick-${value}`,
    nutrition,
    isBudgeted,
  };
}

function separator(value: string): DayLogItem {
  return {
    type: "separator",
    id: id(value),
    label: `section-${value}`,
  };
}

describe("daily log keyboard selection", () => {
  it("normalizes stale selection ids to visible rows", () => {
    const selection = normalizeEntrySelection(
      {
        focusedId: id("missing"),
        anchorId: id("missing"),
        selectedIds: [id("c"), id("missing"), id("b"), id("b")],
      },
      ids,
    );

    assert.equal(selection.focusedId, id("b"));
    assert.equal(selection.anchorId, id("b"));
    assert.deepEqual(selectedIds(selection), ["b", "c"]);
  });

  it("moves single-row focus with arrow keys", () => {
    const first = moveEntrySelection(emptyEntrySelection, ids, "down", false);
    const second = moveEntrySelection(first, ids, "down", false);
    const firstAgain = moveEntrySelection(second, ids, "up", false);

    assert.deepEqual(selectedIds(first), ["a"]);
    assert.deepEqual(selectedIds(second), ["b"]);
    assert.deepEqual(selectedIds(firstAgain), ["a"]);
  });

  it("extends a contiguous range with shift+arrow keys", () => {
    const start = selectEntry(id("b"), ids);
    const extendedDown = moveEntrySelection(start, ids, "down", true);
    const extendedDownAgain = moveEntrySelection(extendedDown, ids, "down", true);
    const backTowardAnchor = moveEntrySelection(
      extendedDownAgain,
      ids,
      "up",
      true,
    );

    assert.equal(extendedDown.anchorId, id("b"));
    assert.equal(extendedDown.focusedId, id("c"));
    assert.deepEqual(selectedIds(extendedDown), ["b", "c"]);
    assert.deepEqual(selectedIds(extendedDownAgain), ["b", "c", "d"]);
    assert.deepEqual(selectedIds(backTowardAnchor), ["b", "c"]);
  });

  it("selects the next surviving row after deletion", () => {
    const selection = moveEntrySelection(
      selectEntry(id("b"), ids),
      ids,
      "down",
      true,
    );
    const next = selectAfterRemovingEntries(
      selection,
      ids,
      new Set([id("b"), id("c")]),
    );

    assert.deepEqual(selectedIds(next), ["d"]);
    assert.equal(next.focusedId, id("d"));
  });

  it("returns an empty selection when all visible rows are removed", () => {
    const next = selectAfterRemovingEntries(
      selectEntry(id("a"), [id("a")]),
      [id("a")],
      new Set([id("a")]),
    );

    assert.deepEqual(next, emptyEntrySelection);
  });
});

describe("daily log keyboard list operations", () => {
  it("moves a contiguous selected block up one row", () => {
    const moved = moveSelectedItems(
      ids.map((value) => ({ id: value })),
      [id("b"), id("c")],
      "up",
    );

    assert.deepEqual(
      moved.map((item) => item.id),
      ["b", "c", "a", "d"],
    );
  });

  it("moves a contiguous selected block down one row", () => {
    const moved = moveSelectedItems(
      ids.map((value) => ({ id: value })),
      [id("b"), id("c")],
      "down",
    );

    assert.deepEqual(
      moved.map((item) => item.id),
      ["a", "d", "b", "c"],
    );
  });

  it("does not move a selected block past the list boundary", () => {
    const movedUp = moveSelectedItems(
      ids.map((value) => ({ id: value })),
      [id("a"), id("b")],
      "up",
    );
    const movedDown = moveSelectedItems(
      ids.map((value) => ({ id: value })),
      [id("c"), id("d")],
      "down",
    );

    assert.deepEqual(
      movedUp.map((item) => item.id),
      ["a", "b", "c", "d"],
    );
    assert.deepEqual(
      movedDown.map((item) => item.id),
      ["a", "b", "c", "d"],
    );
  });

  it("toggles budgeted status for selected food and quick-add rows only", () => {
    const items = [
      entry("a"),
      quick("b", true),
      separator("c"),
      entry("d", true),
    ];
    const toggled = toggleBudgetedForSelectedItems(items, [
      id("a"),
      id("b"),
      id("c"),
    ]);

    assert.equal(toggled[0].type, undefined);
    assert.equal(toggled[0].isBudgeted, true);
    assert.equal(toggled[1].type, "quick-add");
    assert.equal(toggled[1].isBudgeted, undefined);
    assert.equal(toggled[2].type, "separator");
    assert.equal("isBudgeted" in toggled[2], false);
    assert.equal(toggled[3].type, undefined);
    assert.equal(toggled[3].isBudgeted, true);
  });

  it("returns visible row ids while skipping entries in collapsed sections", () => {
    const items = [
      separator("breakfast"),
      entry("eggs"),
      entry("toast"),
      separator("lunch"),
      quick("shake"),
    ];

    assert.deepEqual(
      getVisibleEntryIds(items, new Set([id("breakfast")])),
      ["breakfast", "lunch", "shake"],
    );
  });

  it("returns the insert index below the focused row", () => {
    const items = [entry("a"), entry("b"), entry("c")];
    const selection = {
      focusedId: id("b"),
      anchorId: id("b"),
      selectedIds: [id("b")],
    };

    assert.equal(getAddBelowIndexForSelection(items, selection), 2);
  });

  it("does not return an add-below index when focus is stale", () => {
    const items = [entry("a"), entry("b"), entry("c")];
    const selection = {
      focusedId: id("missing"),
      anchorId: id("missing"),
      selectedIds: [id("missing")],
    };

    assert.equal(getAddBelowIndexForSelection(items, selection), undefined);
  });

  it("uses no insert index for add shortcut when nothing is selected", () => {
    const items = [entry("a"), entry("b"), entry("c")];

    assert.equal(
      getKeyboardAddEntryInsertIndex(items, emptyEntrySelection),
      undefined,
    );
  });

  it("uses the focused row as the add shortcut insert anchor", () => {
    const items = [entry("a"), entry("b"), entry("c")];
    const selection = {
      focusedId: id("b"),
      anchorId: id("b"),
      selectedIds: [id("b")],
    };

    assert.equal(getKeyboardAddEntryInsertIndex(items, selection), 2);
  });
});

describe("daily log keyboard shortcut classification", () => {
  it("maps arrow keys to selection changes", () => {
    assert.deepEqual(getDailyLogKeyboardAction({ key: "ArrowDown" }), {
      type: "select",
      direction: "down",
      extend: false,
    });
    assert.deepEqual(
      getDailyLogKeyboardAction({ key: "ArrowUp", shiftKey: true }),
      {
        type: "select",
        direction: "up",
        extend: true,
      },
    );
  });

  it("maps option+arrow keys to moving the whole selection", () => {
    assert.deepEqual(
      getDailyLogKeyboardAction({ key: "ArrowDown", altKey: true }),
      {
        type: "move-selection",
        direction: "down",
      },
    );
  });

  it("does not intercept cmd+arrow keys", () => {
    assert.equal(
      getDailyLogKeyboardAction({ key: "ArrowDown", metaKey: true }),
      null,
    );
  });

  it("maps escape, backspace/delete, enter, a, m/b, and ? to row operations", () => {
    assert.deepEqual(getDailyLogKeyboardAction({ key: "Escape" }), {
      type: "clear-selection",
    });
    assert.deepEqual(getDailyLogKeyboardAction({ key: "?" }), {
      type: "toggle-shortcuts",
    });
    assert.deepEqual(
      getDailyLogKeyboardAction({ key: "/", code: "Slash", shiftKey: true }),
      {
        type: "toggle-shortcuts",
      },
    );
    assert.deepEqual(getDailyLogKeyboardAction({ key: "Backspace" }), {
      type: "delete-selection",
    });
    assert.deepEqual(getDailyLogKeyboardAction({ key: "Delete" }), {
      type: "delete-selection",
    });
    assert.deepEqual(getDailyLogKeyboardAction({ key: "Enter" }), {
      type: "edit-selection",
    });
    assert.deepEqual(getDailyLogKeyboardAction({ key: "a" }), {
      type: "add-below",
    });
    assert.deepEqual(getDailyLogKeyboardAction({ key: "A" }), {
      type: "add-below",
    });
    assert.deepEqual(getDailyLogKeyboardAction({ key: "m" }), {
      type: "toggle-budgeted",
    });
    assert.deepEqual(getDailyLogKeyboardAction({ key: "M" }), {
      type: "toggle-budgeted",
    });
    assert.deepEqual(getDailyLogKeyboardAction({ key: "b" }), {
      type: "toggle-budgeted",
    });
    assert.deepEqual(getDailyLogKeyboardAction({ key: "B" }), {
      type: "toggle-budgeted",
    });
  });

  it("ignores row-operation shortcuts with conflicting modifiers", () => {
    assert.equal(
      getDailyLogKeyboardAction({ key: "m", metaKey: true }),
      null,
    );
    assert.equal(
      getDailyLogKeyboardAction({ key: "Backspace", ctrlKey: true }),
      null,
    );
    assert.equal(
      getDailyLogKeyboardAction({ key: "m", altKey: true }),
      null,
    );
  });

  it("marks only continuous movement actions as repeatable", () => {
    assert.equal(
      canRepeatDailyLogKeyboardAction({
        type: "select",
        direction: "down",
        extend: false,
      }),
      true,
    );
    assert.equal(
      canRepeatDailyLogKeyboardAction({
        type: "move-selection",
        direction: "up",
      }),
      true,
    );
    assert.equal(
      canRepeatDailyLogKeyboardAction({ type: "clear-selection" }),
      false,
    );
    assert.equal(
      canRepeatDailyLogKeyboardAction({ type: "toggle-shortcuts" }),
      false,
    );
    assert.equal(
      canRepeatDailyLogKeyboardAction({ type: "delete-selection" }),
      false,
    );
  });
});

describe("daily log delete confirmation copy", () => {
  it("uses singular item wording for one selected entry", () => {
    assert.equal(
      getDeleteSelectionDescription(1),
      "You're about to delete 1 item from this day's log report.",
    );
  });

  it("uses plural item wording for multiple selected entries", () => {
    assert.equal(
      getDeleteSelectionDescription(3),
      "You're about to delete 3 items from this day's log report.",
    );
  });
});
