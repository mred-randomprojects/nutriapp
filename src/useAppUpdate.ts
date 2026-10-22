import { useContext, useEffect, useRef, useState } from "react";
import { fetchDeployedCommit, isNewerBuild, reloadNow } from "./appVersion";
import { UnsavedChangesContext } from "./unsavedChanges";
import { isEditableShortcutTarget } from "./shortcutTargets";

/** How often an app left open and in view looks for a new build. */
const CHECK_EVERY_MS = 30 * 60_000;

/**
 * Looks for a newer deployed build when the app comes back into view, when
 * the network comes back, and every half hour while it is in view. It
 * reloads onto it at once when the person has just come back and nothing is
 * being edited; otherwise it returns true, and the app shows a "new version"
 * pill whose button reloads.
 */
export function useAppUpdate(isLocalCopyStored: () => boolean): boolean {
  const unsaved = useContext(UnsavedChangesContext);
  const [ready, setReady] = useState(false);
  const hasUnsaved = useRef(false);
  hasUnsaved.current = unsaved?.hasUnsavedChanges ?? false;
  const localCopyStored = useRef(isLocalCopyStored);
  localCopyStored.current = isLocalCopyStored;

  useEffect(() => {
    let checking = false;
    async function check(returning: boolean) {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const deployed = await fetchDeployedCommit(import.meta.env.BASE_URL, (url, init) =>
          fetch(url, init),
        );
        if (!isNewerBuild(__APP_COMMIT__, deployed)) return;
        const now = reloadNow({
          returning,
          unsavedForm: hasUnsaved.current,
          dialogOpen: document.querySelector('[role="dialog"], [role="alertdialog"]') != null,
          typing: isEditableShortcutTarget(document.activeElement),
          localCopyStored: localCopyStored.current(),
        });
        if (now) window.location.reload();
        else setReady(true);
      } finally {
        checking = false;
      }
    }
    const onReturn = () => void check(true);
    const onOnline = () => void check(false);
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(() => void check(false), CHECK_EVERY_MS);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, []);

  return ready;
}
