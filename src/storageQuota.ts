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

/** NutriApp's keys: `nutriapp-data*` and `nutriapp:food-form-draft:*`. */
export function isNutriAppKey(key: string): boolean {
  return key.startsWith("nutriapp");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
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
