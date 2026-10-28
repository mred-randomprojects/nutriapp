import type { DayLogItem, LogEntryId } from "../types.js";
import type { EntrySelectionState } from "./dailyLogKeyboard.js";

/**
 * Copy, paste and duplicate for the rows of a day's log and of a meal plan.
 *
 * The clipboard is the app's own, kept in memory, not the system one: reading
 * the system clipboard needs a permission prompt in Safari on every paste, and
 * rows are only ever pasted into this app. So it lasts until the page reloads,
 * and `⌘V` pastes the last rows copied here even if text was copied elsewhere
 * since.
 */
let clipboard: ReadonlyArray<DayLogItem> = [];

export function setEntryClipboard(items: ReadonlyArray<DayLogItem>): void {
  clipboard = items.map((item) => ({ ...item }));
}

export function getEntryClipboard(): ReadonlyArray<DayLogItem> {
  return clipboard;
}

/**
 * The rows a copy or a duplicate takes: the selected ones in list order, and
 * with a collapsed section's header, the rows folded under it — what you see
 * as one row is the whole section.
 */
export function collectSelectedItems(
  items: ReadonlyArray<DayLogItem>,
  selectedIds: ReadonlyArray<LogEntryId>,
  collapsedSectionIds: ReadonlySet<LogEntryId>,
): DayLogItem[] {
  const selected = new Set(selectedIds);
  const result: DayLogItem[] = [];
  let takingCollapsedSection = false;

  for (const item of items) {
    if (item.type === "separator") {
      takingCollapsedSection =
        selected.has(item.id) && collapsedSectionIds.has(item.id);
      if (selected.has(item.id)) result.push(item);
      continue;
    }
    if (selected.has(item.id) || takingCollapsedSection) result.push(item);
  }

  return result;
}

/** Copies of `items` with fresh ids, so they are new rows wherever they land. */
export function cloneItemsWithNewIds(
  items: ReadonlyArray<DayLogItem>,
  makeId: () => string,
): DayLogItem[] {
  return items.map((item) => ({ ...item, id: makeId() as LogEntryId }));
}

/**
 * Leaves out entries whose food no longer exists (deleted since the copy):
 * pasted, they would be rows with nothing to show or count.
 */
export function withoutUnknownFoods(
  items: ReadonlyArray<DayLogItem>,
  hasFood: (foodId: string) => boolean,
): DayLogItem[] {
  return items.filter(
    (item) => item.type === "separator" || item.type === "quick-add" || hasFood(item.foodId),
  );
}

/** Pastes go right below the focused row, or at the end with nothing focused. */
export function getPasteInsertIndex(
  items: ReadonlyArray<DayLogItem>,
  selection: EntrySelectionState,
): number {
  if (selection.focusedId == null) return items.length;
  const focusedIndex = items.findIndex((item) => item.id === selection.focusedId);
  return focusedIndex >= 0 ? focusedIndex + 1 : items.length;
}

/** A duplicate goes right below the last of the rows it copies. */
export function getDuplicateInsertIndex(
  items: ReadonlyArray<DayLogItem>,
  copiedItems: ReadonlyArray<DayLogItem>,
): number {
  const copiedIds = new Set(copiedItems.map((item) => item.id));
  let lastIndex = -1;
  items.forEach((item, index) => {
    if (copiedIds.has(item.id)) lastIndex = index;
  });
  return lastIndex >= 0 ? lastIndex + 1 : items.length;
}

export function insertItemsAt(
  items: ReadonlyArray<DayLogItem>,
  newItems: ReadonlyArray<DayLogItem>,
  insertIndex: number,
): DayLogItem[] {
  const safeIndex = Math.max(0, Math.min(insertIndex, items.length));
  return [...items.slice(0, safeIndex), ...newItems, ...items.slice(safeIndex)];
}

/**
 * The selection after a paste or duplicate: the new rows, focused on the last
 * one, so another `⌘V` lands below them and `Shift+↑` extends from there.
 */
export function selectInsertedItems(
  newItems: ReadonlyArray<DayLogItem>,
): EntrySelectionState | null {
  if (newItems.length === 0) return null;
  return {
    focusedId: newItems[newItems.length - 1].id,
    anchorId: newItems[0].id,
    selectedIds: newItems.map((item) => item.id),
  };
}

/** "3 rows", "1 row": for the labels of the history and the feedback. */
export function describeRowCount(count: number): string {
  return `${count} ${count === 1 ? "row" : "rows"}`;
}
