import type { DayLogItem, LogEntryId } from "../types.js";

export type EntrySelectionDirection = "up" | "down";
export type DailyLogKeyboardAction =
  | { type: "select"; direction: EntrySelectionDirection; extend: boolean }
  | { type: "move-selection"; direction: EntrySelectionDirection }
  | { type: "delete-selection" }
  | { type: "toggle-budgeted" }
  | { type: "add-below" };

export interface EntrySelectionState {
  focusedId: LogEntryId | null;
  anchorId: LogEntryId | null;
  selectedIds: LogEntryId[];
}

export interface KeyboardShortcutLike {
  key: string;
  code?: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}

export const emptyEntrySelection: EntrySelectionState = {
  focusedId: null,
  anchorId: null,
  selectedIds: [],
};

function uniqueVisibleIds(
  ids: ReadonlyArray<LogEntryId>,
  visibleIds: ReadonlyArray<LogEntryId>,
): LogEntryId[] {
  const visibleSet = new Set(visibleIds);
  const seen = new Set<LogEntryId>();
  const result: LogEntryId[] = [];

  for (const id of ids) {
    if (!visibleSet.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }

  result.sort((a, b) => visibleIds.indexOf(a) - visibleIds.indexOf(b));
  return result;
}

function rangeIds(
  ids: ReadonlyArray<LogEntryId>,
  startIndex: number,
  endIndex: number,
): LogEntryId[] {
  const start = Math.min(startIndex, endIndex);
  const end = Math.max(startIndex, endIndex);
  return ids.slice(start, end + 1);
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, length - 1));
}

export function normalizeEntrySelection(
  selection: EntrySelectionState,
  visibleIds: ReadonlyArray<LogEntryId>,
): EntrySelectionState {
  if (visibleIds.length === 0) return emptyEntrySelection;

  const selectedIds = uniqueVisibleIds(selection.selectedIds, visibleIds);
  const focusedId =
    selection.focusedId != null && visibleIds.includes(selection.focusedId)
      ? selection.focusedId
      : (selectedIds[0] ?? null);
  const anchorId =
    selection.anchorId != null && visibleIds.includes(selection.anchorId)
      ? selection.anchorId
      : focusedId;

  if (focusedId == null) return emptyEntrySelection;
  return {
    focusedId,
    anchorId,
    selectedIds: selectedIds.length > 0 ? selectedIds : [focusedId],
  };
}

export function selectEntry(
  id: LogEntryId,
  visibleIds: ReadonlyArray<LogEntryId>,
): EntrySelectionState {
  if (!visibleIds.includes(id)) return emptyEntrySelection;
  return {
    focusedId: id,
    anchorId: id,
    selectedIds: [id],
  };
}

export function moveEntrySelection(
  selection: EntrySelectionState,
  visibleIds: ReadonlyArray<LogEntryId>,
  direction: EntrySelectionDirection,
  extend: boolean,
): EntrySelectionState {
  if (visibleIds.length === 0) return emptyEntrySelection;

  const normalized = normalizeEntrySelection(selection, visibleIds);
  const currentIndex =
    normalized.focusedId == null
      ? direction === "down"
        ? -1
        : visibleIds.length
      : visibleIds.indexOf(normalized.focusedId);
  const nextIndex = clampIndex(
    currentIndex + (direction === "down" ? 1 : -1),
    visibleIds.length,
  );
  const nextFocusedId = visibleIds[nextIndex];

  if (!extend || normalized.focusedId == null || normalized.anchorId == null) {
    return {
      focusedId: nextFocusedId,
      anchorId: nextFocusedId,
      selectedIds: [nextFocusedId],
    };
  }

  const anchorIndex = visibleIds.indexOf(normalized.anchorId);
  return {
    focusedId: nextFocusedId,
    anchorId: normalized.anchorId,
    selectedIds: rangeIds(visibleIds, anchorIndex, nextIndex),
  };
}

export function selectAfterRemovingEntries(
  selection: EntrySelectionState,
  visibleIds: ReadonlyArray<LogEntryId>,
  removedIds: ReadonlySet<LogEntryId>,
): EntrySelectionState {
  if (visibleIds.length === 0) return emptyEntrySelection;
  const remainingIds = visibleIds.filter((id) => !removedIds.has(id));
  if (remainingIds.length === 0) return emptyEntrySelection;

  const normalized = normalizeEntrySelection(selection, visibleIds);
  const selectedIndexes = normalized.selectedIds
    .map((id) => visibleIds.indexOf(id))
    .filter((index) => index >= 0);
  const fallbackIndex =
    selectedIndexes.length > 0 ? Math.min(...selectedIndexes) : 0;
  const nextIndex = clampIndex(fallbackIndex, remainingIds.length);
  return selectEntry(remainingIds[nextIndex], remainingIds);
}

export function moveSelectedItems<T extends { id: LogEntryId }>(
  items: ReadonlyArray<T>,
  selectedIds: ReadonlyArray<LogEntryId>,
  direction: EntrySelectionDirection,
): T[] {
  const selected = new Set(selectedIds);
  const next = [...items];

  if (selected.size === 0) return next;

  if (direction === "up") {
    for (let index = 1; index < next.length; index++) {
      if (selected.has(next[index].id) && !selected.has(next[index - 1].id)) {
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
      }
    }
    return next;
  }

  for (let index = next.length - 2; index >= 0; index--) {
    if (selected.has(next[index].id) && !selected.has(next[index + 1].id)) {
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
    }
  }
  return next;
}

export function toggleBudgetedForSelectedItems(
  items: ReadonlyArray<DayLogItem>,
  selectedIds: ReadonlyArray<LogEntryId>,
): DayLogItem[] {
  const selected = new Set(selectedIds);

  return items.map((item) => {
    if (!selected.has(item.id) || item.type === "separator") return item;
    return {
      ...item,
      isBudgeted: item.isBudgeted === true ? undefined : true,
    };
  });
}

export function getVisibleEntryIds(
  items: ReadonlyArray<DayLogItem>,
  collapsedSectionIds: ReadonlySet<LogEntryId>,
): LogEntryId[] {
  const visibleIds: LogEntryId[] = [];
  let currentSectionId: LogEntryId | null = null;

  for (const item of items) {
    if (item.type === "separator") {
      currentSectionId = item.id;
      visibleIds.push(item.id);
      continue;
    }

    if (currentSectionId != null && collapsedSectionIds.has(currentSectionId)) {
      continue;
    }

    visibleIds.push(item.id);
  }

  return visibleIds;
}

export function getDailyLogKeyboardAction(
  event: KeyboardShortcutLike,
): DailyLogKeyboardAction | null {
  if (event.ctrlKey) return null;

  const isArrowUp = event.key === "ArrowUp";
  const isArrowDown = event.key === "ArrowDown";
  if (isArrowUp || isArrowDown) {
    const direction = isArrowUp ? "up" : "down";
    if (event.altKey || event.metaKey) {
      return { type: "move-selection", direction };
    }
    return { type: "select", direction, extend: event.shiftKey === true };
  }

  if (event.metaKey || event.altKey || event.shiftKey) return null;

  if (event.key === "Backspace" || event.key === "Delete") {
    return { type: "delete-selection" };
  }

  if (event.key === "a" || event.key === "A" || event.code === "KeyA") {
    return { type: "add-below" };
  }

  if (event.key === "m" || event.key === "M" || event.code === "KeyM") {
    return { type: "toggle-budgeted" };
  }

  return null;
}

export function getAddBelowIndexForSelection(
  items: ReadonlyArray<DayLogItem>,
  selection: EntrySelectionState,
): number | undefined {
  if (selection.focusedId == null) return undefined;
  const focusedIndex = items.findIndex((item) => item.id === selection.focusedId);
  return focusedIndex >= 0 ? focusedIndex + 1 : undefined;
}

export function getDeleteSelectionDescription(itemCount: number): string {
  const safeCount = Math.max(0, Math.floor(itemCount));
  const itemLabel = safeCount === 1 ? "item" : "items";
  return `You're about to delete ${safeCount} ${itemLabel} from this day's log report.`;
}
