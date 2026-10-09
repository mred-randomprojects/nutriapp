import { backupFileName, serializeBackup } from "./backup";
import type { AppData } from "./types";

/** Hands the browser a JSON file of `data` to save. Export only: no import. */
export function downloadBackup(data: AppData): void {
  const blob = new Blob([serializeBackup(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = backupFileName();
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Safari may still be reading the blob after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 40_000);
}
