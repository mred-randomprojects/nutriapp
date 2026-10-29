/** Every app on mred-randomprojects.github.io shares one ~5 MB localStorage. */
export const ORIGIN_QUOTA_BYTES = 5 * 1024 * 1024; // the meters count UTF-16: chars × 2

export function isQuotaError(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22)
  );
}

export interface StorageSplit {
  mine: number;
  others: number;
}

/** This app's bytes vs. everybody else's. Reads lengths only. */
export function storageUsage(isMine: (key: string) => boolean): StorageSplit {
  let mine = 0;
  let others = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null) continue;
      const bytes = (key.length + (localStorage.getItem(key)?.length ?? 0)) * 2;
      if (isMine(key)) mine += bytes;
      else others += bytes;
    }
  } catch {
    /* storage blocked */
  }
  return { mine, others };
}

/**
 * Which app on the origin writes which keys, by prefix (from each app's
 * source, 2026-10-29). Keys no prefix matches are "Unknown".
 */
const APP_KEY_PREFIXES: [app: string, prefixes: string[]][] = [
  ["NutriApp", ["nutriapp"]],
  ["fulbito", ["fulbito"]],
  ["dineros", ["dineros"]],
  ["candito-tool", ["candito"]],
  ["cuentas", ["cuentas"]],
  ["execute", ["execute"]],
  ["age-defense", ["age-defense"]],
  ["viaje-matematico", ["mathjourney"]],
  ["minecraft-ladder", ["minecraft-ladder"]],
  ["terrateniente", ["terrateniente"]],
  ["guess-class-lol", ["guess-class-lol", "skills-trainer-history"]],
  ["Firebase", ["firebase:"]],
];

export function appOfKey(key: string): string {
  for (const [app, prefixes] of APP_KEY_PREFIXES) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) return app;
  }
  return "Unknown";
}

/** Each app's share of the origin's localStorage, biggest first. Reads lengths only. */
export function storageByApp(): { app: string; bytes: number; keys: number }[] {
  const byApp = new Map<string, { bytes: number; keys: number }>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null) continue;
      const app = appOfKey(key);
      const entry = byApp.get(app) ?? { bytes: 0, keys: 0 };
      entry.bytes += (key.length + (localStorage.getItem(key)?.length ?? 0)) * 2;
      entry.keys += 1;
      byApp.set(app, entry);
    }
  } catch {
    /* storage blocked */
  }
  return [...byApp].map(([app, entry]) => ({ app, ...entry })).sort((a, b) => b.bytes - a.bytes);
}

/** NutriApp's keys: `nutriapp-data*` and `nutriapp:food-form-draft:*`. */
export function isNutriAppKey(key: string): boolean {
  return key.startsWith("nutriapp");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/**
 * What to tell the user when the shared quota is full or nearly full. Only
 * points at NutriApp's own profiles when NutriApp holds at least half of it.
 */
export function storageSpaceMessage(split: StorageSplit, state: "full" | "almost-full"): string {
  const lead =
    state === "full"
      ? "This browser is out of space for this site."
      : "This browser is almost out of space for this site.";
  const share = `All apps on mred-randomprojects.github.io share about 5 MB: this one uses ${formatBytes(split.mine)}, the others ${formatBytes(split.others)}.`;
  const advice =
    split.mine >= split.others
      ? "Download a backup from Account, then delete old profiles to free space."
      : "Most of it is other apps' data. Download a backup from Account to be safe.";
  return `${lead} ${share} ${advice}`;
}

/**
 * What an IndexedDB record takes, counted the way the localStorage meter
 * counts: its text, as JSON for anything that is not a string, at 2 bytes a
 * char. The browser keeps its own encoding on disk, so this is an
 * approximation.
 */
export function approximateBytes(key: unknown, value: unknown): number {
  const keyText = typeof key === "string" ? key : (JSON.stringify(key) ?? "");
  const valueText = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  return (keyText.length + valueText.length) * 2;
}
