import { useEffect } from "react";
import {
  giveExplicitTabIndex,
  normalizeKeyboardFocusOrder,
} from "./keyboardFocusParity";

/**
 * Keep every control in the keyboard focus order on every engine — see
 * `keyboardFocusParity.ts` for why WebKit needs this and Blink does not notice.
 *
 * Wired once, in `App`. Doing it here rather than spelling `tabIndex={0}` onto
 * each of the app's buttons is what makes it hold: the next button someone adds
 * is reachable without having remembered this, and so are the ones Radix and
 * `cmd-s` render into portals, which no component here can annotate.
 *
 * Only added nodes are watched. An attribute watcher would fire on every class
 * and transform change in the app — every drag frame — to re-answer a question
 * that is settled when an element mounts.
 */
export function useKeyboardFocusParity(): void {
  useEffect(() => {
    normalizeKeyboardFocusOrder(document);

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          giveExplicitTabIndex(node);
          normalizeKeyboardFocusOrder(node);
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
}
