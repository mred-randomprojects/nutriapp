# NutriApp — Guiding Principles

## Keyboard-first is a product requirement, not a nice-to-have

This app is meant to be driven **primarily by the keyboard**. A mouse must always
work, but every meaningful action should also have an intuitive, guessable key
binding. We have repeatedly shipped flows that "work" but feel broken because an
obvious binding was missing (Esc didn't go back, arrows didn't move the
selection, Enter didn't confirm). Treat a missing binding as a bug.

**When you build or change any interactive surface** (dialog, menu, form, list,
new page), you are not done until you have answered: *what does Esc do here? what
does Enter do? what do the arrows do?* If the answer is "nothing" where a user
would reasonably expect something, wire it up.

## The key "grammar" — reuse these meanings everywhere

Consistency is what makes bindings guessable. Do not invent a new meaning for a
key that already has one below. Reuse the shared helpers rather than
re-implementing key handling:

- `Esc` → **go back / cancel one level.** Close the open menu, dialog, or
  picker; step back to the previous sub-state; or clear the current selection.
  It should _never_ be a dead key when there is a level to back out of. Use
  `handleFormEscapeCancel` / `isFormEscapeCancel` (`src/formEscapeCancel.ts`).
- `Enter` → **confirm the primary action** / commit the highlighted option.
- `Cmd/Ctrl+Enter` → **submit the surrounding form** from any field
  (`submitClosestFormFromShortcut`).
- `Cmd/Ctrl+S` → **the app's save, never the browser's dialog.** Inside a form
  it submits that form like `Cmd/Ctrl+Enter`; elsewhere it shows a "Saved"
  toast (everything already autosaves). Wired once in `App.tsx` through the
  shared `cmd-s` package (`github:mred-randomprojects/cmd-s`).
- `↑ / ↓` → **move the selection/highlight** within a list. In "type-to-search"
  option lists use the shared `useOptionListKeyboard` hook (arrows move the
  highlight, `Enter` selects, hover syncs, scroll-into-view) — do not hand-roll.
- `Shift+↑/↓` → extend a multi-selection; `Alt+↑/↓` → reorder the selection.
- `Space` → trigger the page's primary "add/create" action when not typing.
- `?` → toggle the contextual keyboard-shortcut panel.
- Single letters (`t`, `a`, `m`/`b`, …) → fast actions **only when focus is not
  in a text field**. Always guard with an editable-target check.

## Canonical keymap (keep this current when you add bindings)

Global
- `1`–`6` — switch tabs: Foods / Log / Plans / Trend / Profiles / Account
- `Cmd/Ctrl+K` — open the command palette (navigate + actions + open history)
- `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` — undo / redo
- `Cmd/Ctrl+S` — submit the focused form, or confirm "Saved"

Daily log
- `↑ / ↓` select entry · `Shift+↑/↓` extend · `Alt+↑/↓` move entry
- `Enter` edit · `Delete`/`Backspace` delete · `a` add below · `m`/`b` toggle budgeted
- `t` jump to today · `← / →` previous / next day · `?` shortcuts panel · `Esc` clear selection

Plan editor (`/plans/:planId/edit`)
- reuses the daily-log entry grammar: `↑ / ↓` select · `Alt+↑/↓` move · `Enter` edit ·
  `Delete`/`Backspace` remove · `m`/`b` toggle budgeted · `a` add below · `Space` add ·
  `Esc` clear selection. Name + description are plain fields; `Save` commits, `Cancel`
  leaves (guarded by the unsaved-changes prompt).

Add / search flows (log entry, ingredient, meal plan pickers)
- type to filter · `↑ / ↓` move highlight · `Enter` select · `Esc` back a step / close

Foods
- `Space` — Add Food

Forms & menus
- `Esc` — cancel / back (guarded by the unsaved-changes prompt) · `Cmd/Ctrl+Enter` — submit
- open dropdown menus close on `Esc` and on outside click

## One focus model on every engine

The app that actually gets used is a macOS **Safari web app** ("Add to Dock"), so
WebKit — not Blink — is the engine that matters, and the two do not agree on
keyboard focus. By default WebKit leaves `<button>`, `a[href]` and the non-text
inputs out of the tab order *and* does not focus them on click, so
`document.activeElement` stays on `<body>`. Measured, tabbing a page of controls:

```
Blink  : text  button  a[href]  checkbox  select  textarea
WebKit : text                             select  textarea
```

Every control in this app is a button, so untreated that means Tab reaches
nothing, and `Esc` / `⌘Enter` / `⌘S` go dead inside a form after any click —
all three read the focused element, and in WebKit a click leaves it outside the
form.

`useKeyboardFocusParity` (`src/useKeyboardFocusParity.ts`, wired once in
`App.tsx`) fixes this centrally by writing `tabindex="0"` onto those controls as
they mount, which restores WebKit's tab order and click-focus and changes nothing
in Blink. **Do not** hand-roll `tabIndex={0}` per component, and do not assume a
click leaves the focus where Chrome leaves it — test the installed app, or any
WebKit build, before calling a binding done.

## Guards to always apply

- Ignore shortcuts when `event.defaultPrevented` or an unexpected modifier is held.
- Skip single-key/letter shortcuts when the target is an `input`, `textarea`,
  `select`, or `contentEditable` element (let people type). `Cmd/Ctrl+Z` must
  also defer to native text undo while a field is focused.
- When a modal/menu is open, suppress lower-priority global shortcuts so `Esc`
  and friends act on the top-most layer only. Use `isInsideModalLayer`
  (`src/shortcutTargets.ts`) rather than each page tracking its own dialogs: the
  command palette lists its commands as plain buttons, and a page that only
  checks its own state will read arrows out from under them.
- Let the focused element keep **only its own** keys (`src/shortcutTargets.ts`):
  a text field takes every single-key shortcut, a menu or listbox takes the
  arrows, and a button takes `Enter` and `Space` — and nothing more. Treating
  "a button has the focus" as "this page has no shortcuts" kills the whole entry
  grammar after one click on the nav bar.
