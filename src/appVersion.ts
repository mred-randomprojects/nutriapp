/**
 * Moving long-lived sessions to new builds. The installed Safari app ("Add
 * to Dock") stays open for days and has no service worker, so without this
 * it keeps running whatever build it loaded, sync engine included.
 *
 * The build knows its own commit (vite.config.ts injects it); the deploy
 * publishes the live one in `version.json`. Whenever the app comes back into
 * view, or the network back, it compares the two.
 */

/** What a check needs from `fetch`. */
export type FetchLike = (url: string, init?: { cache?: "no-store" }) => Promise<Response>;

/** The commit the site serves now, or null when it cannot tell (offline, no file). */
export async function fetchDeployedCommit(base: string, fetchFn: FetchLike): Promise<string | null> {
  try {
    const response = await fetchFn(`${base}version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (body == null || typeof body !== "object") return null;
    const commit = (body as Record<string, unknown>).commit;
    return typeof commit === "string" && commit.length > 0 ? commit : null;
  } catch {
    return null;
  }
}

/** Whether `deployed` is another build than this one. A dev build never is. */
export function isNewerBuild(current: string, deployed: string | null): boolean {
  return current !== "dev" && deployed != null && deployed !== current;
}

export interface ReloadMoment {
  /** The app just came back into view (focus, visibility): nobody is mid-action. */
  returning: boolean;
  /** A form holds changes not saved yet (UnsavedChangesProvider). */
  unsavedForm: boolean;
  dialogOpen: boolean;
  /** The focus is in a text field. */
  typing: boolean;
  /** This device's copy is fully stored: a reload loses nothing. */
  localCopyStored: boolean;
}

/**
 * Whether to reload onto the new build right away. Only when the person
 * just came back and nothing is being edited; otherwise a pill offers it,
 * and the next return tries again.
 */
export function reloadNow(moment: ReloadMoment): boolean {
  return (
    moment.returning &&
    !moment.unsavedForm &&
    !moment.dialogOpen &&
    !moment.typing &&
    moment.localCopyStored
  );
}
