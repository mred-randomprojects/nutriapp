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
- `Cmd/Ctrl+K` — open the History (undo) panel
- `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` — undo / redo

Daily log
- `↑ / ↓` select entry · `Shift+↑/↓` extend · `Alt+↑/↓` move entry
- `Enter` edit · `Delete`/`Backspace` delete · `a` add below · `m`/`b` toggle budgeted
- `t` jump to today · `← / →` previous / next day · `?` shortcuts panel · `Esc` clear selection

Add / search flows (log entry, ingredient, meal plan pickers)
- type to filter · `↑ / ↓` move highlight · `Enter` select · `Esc` back a step / close

Foods
- `Space` — Add Food

Forms & menus
- `Esc` — cancel / back (guarded by the unsaved-changes prompt) · `Cmd/Ctrl+Enter` — submit
- open dropdown menus close on `Esc` and on outside click

## Guards to always apply

- Ignore shortcuts when `event.defaultPrevented` or an unexpected modifier is held.
- Skip single-key/letter shortcuts when the target is an `input`, `textarea`,
  `select`, or `contentEditable` element (let people type). `Cmd/Ctrl+Z` must
  also defer to native text undo while a field is focused.
- When a modal/menu is open, suppress lower-priority global shortcuts so `Esc`
  and friends act on the top-most layer only.
