/**
 * One keyboard focus model on every engine.
 *
 * Blink (Chrome, Brave, Edge) puts every natively focusable control in the
 * sequential focus order and focuses it when you click it. WebKit — Safari, and
 * so every macOS "Add to Dock" web app, which is where this app actually gets
 * used — leaves most of them out of both unless the attribute is written down.
 * Tab from the top of a page of controls, measured:
 *
 *   Blink  : text  button  a[href]  checkbox  select  textarea  …
 *   WebKit : text                             select  textarea  …
 *
 * and a click on a `<button>` in WebKit leaves `document.activeElement` on
 * `<body>`. Both follow the macOS convention, and both are switchable by the
 * reader (Safari ▸ Advanced ▸ "Press Tab to highlight each item on a webpage",
 * System Settings ▸ Keyboard ▸ keyboard navigation) — which is no use to us:
 * off is the default, so off is what the app has to work under.
 *
 * Two things break on that here, both silently:
 *
 *   - Tab stops reaching anything. Every control in this app is a `<button>`
 *     and there is not one link, so Tab walks the text fields and skips the
 *     rest of the app.
 *   - `Esc`, `⌘Enter` and `⌘S` go dead inside a form after any click. All three
 *     read the focused element — `Esc` and `⌘Enter` through a React `onKeyDown`
 *     on the form, `⌘S` through `document.activeElement` — so when a click on a
 *     button leaves the focus on `<body>`, outside the form, the keydown never
 *     reaches the form's handler and there is no form under the focus to save.
 *
 * The fix is the documented one: write `tabindex="0"` onto the controls WebKit
 * skips. That restores them to WebKit's tab order *and* makes WebKit focus them
 * on click, which is what the rest of this app's key handling assumes. In Blink
 * it changes nothing: those controls are already in the tab order, and
 * `tabindex="0"` keeps them in document order rather than moving them.
 *
 * It runs on every engine rather than behind a WebKit sniff. One DOM, one tab
 * order, nothing that only breaks on the engine nobody is looking at.
 *
 * The DOM is reached through the small structural types below so that this
 * module — and its tests — need no `lib: DOM`.
 */

/**
 * The `input` types Blink puts in the tab order and WebKit does not. The
 * text-like and date-like types are deliberately absent: both engines already
 * agree on those, and listing them would only add churn.
 */
const SKIPPED_INPUT_TYPES = [
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
] as const;

/** Everything Blink makes keyboard-reachable and WebKit does not. */
export const WEBKIT_SKIPPED_CONTROL_SELECTOR = [
  "button",
  "a[href]",
  ...SKIPPED_INPUT_TYPES.map((type) => `input[type="${type}"]`),
].join(", ");

/** The part of `Element` this module uses. */
export interface FocusParityElement {
  matches(selector: string): boolean;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
}

/** The part of `Document` / `Element` this module uses. */
export interface FocusParityRoot {
  querySelectorAll(selector: string): ArrayLike<FocusParityElement>;
}

/**
 * An explicit `tabindex` is a decision someone already made — Radix's roving
 * tab stops, the `tabIndex={isFocused ? 0 : -1}` on the log's rows — and it is
 * honoured on both engines, so it is left exactly as it is.
 */
export function needsExplicitTabIndex(element: FocusParityElement): boolean {
  return (
    element.matches(WEBKIT_SKIPPED_CONTROL_SELECTOR) &&
    !element.hasAttribute("tabindex")
  );
}

/** Give one element its explicit tab stop. Returns whether it needed one. */
export function giveExplicitTabIndex(element: FocusParityElement): boolean {
  if (!needsExplicitTabIndex(element)) return false;
  element.setAttribute("tabindex", "0");
  return true;
}

/**
 * Give every control under `root` its explicit tab stop. Returns how many
 * needed one, which is what the tests assert on.
 *
 * `root` itself is not considered — a caller holding a single new element
 * should ask `giveExplicitTabIndex` about it directly.
 */
export function normalizeKeyboardFocusOrder(root: FocusParityRoot): number {
  const controls = root.querySelectorAll(WEBKIT_SKIPPED_CONTROL_SELECTOR);
  let changed = 0;

  for (let index = 0; index < controls.length; index++) {
    // `querySelectorAll` already matched the selector; only the attribute is
    // still in question.
    const control = controls[index];
    if (control.hasAttribute("tabindex")) continue;
    control.setAttribute("tabindex", "0");
    changed += 1;
  }

  return changed;
}
