/**
 * What the focused element is allowed to take away from a global shortcut.
 *
 * Shared by the daily log and the plan editor, which run the same entry
 * grammar and so have to answer this the same way.
 *
 * Three kinds of target, because they deserve three different answers:
 *
 *   - **Editable** — a field someone is typing in. Takes every single-key
 *     shortcut: letters are letters there.
 *   - **A composite widget** — a menu, a listbox, a tab list. Owns the arrow
 *     keys for moving within itself, so the list's own `↑ / ↓` must stand down.
 *   - **An activatable control** — a button or a link. Owns `Enter` and `Space`,
 *     which activate it, and *nothing else*. `↑ / ↓`, `a`, `m`/`b` and
 *     `Delete` mean nothing to a focused button, so they stay with the page.
 *
 * That last line is the one worth keeping. Every control here is a button —
 * including the six nav tabs at the bottom — so treating "a button has the
 * focus" as "the page has no shortcuts" leaves the whole entry grammar dead
 * after a single click on the nav bar, which is exactly what it used to do on
 * Blink. WebKit hid that for years by not focusing buttons on click at all
 * (see `keyboardFocusParity.ts`); now that both engines agree on the focus, the
 * guard has to be the narrow one.
 */

const COMPOSITE_WIDGET_SELECTOR = [
  '[role="menu"]',
  '[role="menubar"]',
  '[role="menuitem"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="tablist"]',
  '[role="tab"]',
  '[role="radiogroup"]',
  '[role="grid"]',
].join(",");

/**
 * A layer that sits on top of the page: Radix gives every dialog `role="dialog"`,
 * and a menu `role="menu"`.
 */
const MODAL_LAYER_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
].join(",");

const ACTIVATABLE_CONTROL_SELECTOR = [
  "button",
  "a[href]",
  "summary",
  '[role="button"]',
  '[role="link"]',
].join(",");

/** A field someone could be typing in. */
export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement)
  );
}

/** Inside a widget that moves its own selection with the arrow keys. */
export function isCompositeWidgetTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(COMPOSITE_WIDGET_SELECTOR) != null
  );
}

/** A control that `Enter` and `Space` activate. */
export function isActivatableControlTarget(
  target: EventTarget | null,
): boolean {
  return (
    target instanceof Element &&
    target.closest(ACTIVATABLE_CONTROL_SELECTOR) != null
  );
}

/**
 * Inside a dialog or a menu — a layer the page underneath does not own.
 *
 * The page's own shortcuts have to stand down for all of it, not just for the
 * focused element: the command palette lists its commands as plain buttons, so
 * a `↓` with one of them focused would otherwise walk the log's selection
 * around behind the open palette.
 */
export function isInsideModalLayer(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest(MODAL_LAYER_SELECTOR) != null
  );
}

/**
 * Any of the three. For `Enter` and `Space`, which every one of them claims.
 */
export function isInteractiveShortcutTarget(
  target: EventTarget | null,
): boolean {
  return (
    isEditableShortcutTarget(target) ||
    isCompositeWidgetTarget(target) ||
    isActivatableControlTarget(target)
  );
}
