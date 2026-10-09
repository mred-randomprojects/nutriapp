import { format } from "date-fns";
import type { AppData } from "./types.js";

/**
 * The backup is byte-for-byte what `nutriapp-data` holds in localStorage, so
 * it can be read back by the same code (or pasted back by hand).
 */
export function serializeBackup(data: AppData): string {
  return JSON.stringify(data);
}

/** `nutriapp-backup-YYYY-MM-DD.json`, dated with the *local* calendar day. */
export function backupFileName(now: Date = new Date()): string {
  return `nutriapp-backup-${format(now, "yyyy-MM-dd")}.json`;
}
