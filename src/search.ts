/**
 * Strips diacritics (accents) and lowercases so that e.g. "cafe" matches "café".
 * Every search filter in the app should use this instead of raw `.toLowerCase()`.
 */
export function normalizeForSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
