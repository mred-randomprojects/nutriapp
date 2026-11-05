/**
 * How the day's entries are drawn: "compact" is a one-line summary per entry
 * (the day at a glance), "comfortable" the usual card with its photo, and
 * "gallery" each entry under a large photo. A per-device preference, kept in
 * localStorage under NutriApp's prefix; the shared quota can be full, so
 * saving it may fail, and then the choice lasts until the page reloads.
 */
export type EntryView = "compact" | "comfortable" | "gallery";

export const ENTRY_VIEWS: ReadonlyArray<EntryView> = ["compact", "comfortable", "gallery"];

export const ENTRY_VIEW_LABELS: Record<EntryView, string> = {
  compact: "Compact",
  comfortable: "Comfortable",
  gallery: "Gallery",
};

export const ENTRY_VIEW_STORAGE_KEY = "nutriapp:entry-view";

export function parseEntryView(value: string | null): EntryView {
  return ENTRY_VIEWS.find((v) => v === value) ?? "comfortable";
}

/** The view after `view`, wrapping around: the `v` shortcut's cycle. */
export function nextEntryView(view: EntryView): EntryView {
  return ENTRY_VIEWS[(ENTRY_VIEWS.indexOf(view) + 1) % ENTRY_VIEWS.length];
}

export function loadEntryView(): EntryView {
  try {
    return parseEntryView(localStorage.getItem(ENTRY_VIEW_STORAGE_KEY));
  } catch {
    return "comfortable";
  }
}

export function saveEntryView(view: EntryView): void {
  try {
    localStorage.setItem(ENTRY_VIEW_STORAGE_KEY, view);
  } catch {
    /* storage blocked or full: keep the choice for this page only */
  }
}
