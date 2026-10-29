# Moving NutriApp's local copy from localStorage to IndexedDB

Started 2026-10-29, when the storage bar warned the site was almost out of
space. Rule for every phase: **nothing is deleted** until a later phase says so
explicitly, has been verified on the real device, and the owner has said yes.

## Why

Every app on `mred-randomprojects.github.io` shares one origin, so they share
one `localStorage` of about 5 MB (see "Shared browser origin" in `CLAUDE.md`).
IndexedDB is per origin too, but its quota is a share of the disk (hundreds of
MB or more in Safari and Chrome), not 5 MB.

## What uses the space (measured 2026-10-29)

The device's `localStorage` itself could not be read from outside the browser
(the Safari web app's container is protected by macOS), so NutriApp's share was
measured from its cloud copy, which holds the same `AppData`:

| What | Size |
|---|---|
| `AppData` as JSON (`nutriapp-data`) | 664,873 chars |
| …of which profiles (167 day logs) | 354,628 |
| …deletion tombstones (`deletedDayLogEntries`) | 172,831 |
| …user foods | 137,272 |
| `nutriapp-data-backup` (the previous copy) | about the same again |
| `nutriapp-sync:<uid>`, `nutriapp-data-owner`, form drafts | small |

So NutriApp keeps **two full copies**, about 1.33 M chars, which the app's
meter counts as 2.66 MB (UTF-16, chars × 2) of the 5 MB. Whether Safari
counts Latin-1 text at 1 or 2 bytes per char is not verified; the meter
assumes 2, which errs on the safe side.

The other apps' keys, from their source (sizes are only known on the device;
the Account page now shows the breakdown by app, see Phase 0):

| App | Keys |
|---|---|
| fulbito | `fulbito-data`, `fulbito-data-backup`, `fulbito-data-corrupt-recovery`, `fulbito-cloud`, `fulbito-balance-v1`, `fulbito-comparisons-v1`, … (+ IndexedDB for avatars) |
| dineros | `dineros-data`, `dineros-data-backup`, `dineros-data-before-restore`, `dineros-data-corrupt-recovery` |
| candito-tool | `candito-*` (history, backup, cycle, …) |
| cuentas | `cuentas.v1`, `cuentas.v2` |
| execute | `execute-store`, `execute.v2.*` |
| others | `age-defense-*`, `mathjourney.*`, `minecraft-ladder-v1`, `terrateniente.*`, `guess-class-lol:*` and `skills-trainer-history` (the last one has no app prefix) |

Several apps keep a full backup copy next to their data, so each one costs
twice its size. NutriApp is the biggest known one and goes first.

## How it lives with the Firebase sync

The cloud copy (Firestore, `users/<uid>/data/appData`) and the sync engine
(`src/syncEngine.ts`) do not change in any phase: the engine reads and writes
"the local copy" through a `Storage` it is handed, and only what backs that
`Storage` changes. The cloud stays a third, independent copy throughout, and
the IndexedDB safety copy (`nutriapp-safety`, `src/safetyStore.ts`) stays as
it is.

## Phases

### Phase 0 — measure on the device (done with phase 1)

The storage bar's label already splits NutriApp from the rest. The Account
page now lists every app's share of the origin's `localStorage`, by key
prefix, so the real numbers can be read on the device that warned.

### Phase 1 — mirror into IndexedDB (this change)

- `localStorage` stays the **source of truth**: everything reads it exactly as
  before, and its writes behave (and fail) exactly as before.
- Every write the sync engine makes to a `nutriapp*` key is mirrored into the
  IndexedDB database `nutriapp-storage`, object store `localStorage`, one record
  per key holding the exact string (`src/storageMirror.ts`). The mirror reads
  the key's value from `localStorage` when its write runs, so it always ends on
  what `localStorage` holds, also with several tabs writing.
- At launch, every `nutriapp*` key already in `localStorage` is copied into the
  mirror (only the ones that differ), then everything is read back and
  compared string for string.
- The food form's drafts (`nutriapp:food-form-draft:*`) are left out: the form
  writes them straight to `localStorage` and deletes them once the food is
  saved, so a mirrored copy would outlive them. They are small and stay in
  `localStorage` in every phase.
- The mirror never deletes. When `localStorage` drops a key (the backup, when
  the quota is full), the mirror keeps its last value.
- The result shows on the Account page ("IndexedDB copy: identical, N keys")
  and in the console (`[storage-mirror]`).

**Verify:** unit tests (`src/storageMirror.test.ts`) cover the mirror,
including that no key and no value is ever lost or deleted, that the sync
engine leaves `localStorage` byte for byte as it does without the mirror (also
when the origin fills up and the engine drops its backup, which the mirror
keeps), and that a failing IndexedDB changes nothing for `localStorage`.
Checked by hand on 2026-10-29 in WebKit (Playwright) with a copy of the real
data (665 K chars) through launch and an edit, and in Safari 27. On the
device: open the app and check the Account page says the copy is identical.

**Roll back:** revert the commit. `localStorage` was never changed by this
phase, so nothing needs restoring. The `nutriapp-storage` database can stay;
it is unused without this code.

### Phase 2 — read from IndexedDB (later)

- Before mounting the app, load the mirror into memory, and hand the engine a
  synchronous `Storage` backed by that memory, written through to IndexedDB
  (and still to `localStorage`).
- At launch, compare both copies. When they differ, take the `localStorage`
  one (still the truth) and report the difference: this should never happen
  after phase 1.
- Verify on the device for a few days of normal use that the Account page keeps
  saying "identical".

**Roll back:** revert; `localStorage` still holds everything.

### Phase 3 — free `localStorage` (only with the owner's OK)

1. Download a JSON backup from Account.
2. Stop writing `nutriapp-data-backup` to `localStorage` (the backup lives in
   IndexedDB): frees about half of NutriApp's share.
3. Later, stop writing `nutriapp-data` there too, keeping the last value until
   IndexedDB has been the only store for a while.
4. Removing the old keys is a separate, explicit step.

**Roll back:** the app can write `localStorage` again from IndexedDB at any
time, as long as the data fits.

### Phase 4 — the other apps

Same pattern, app by app, starting with the biggest one the Account page
shows. If the code repeats, move it into a small shared package like `cmd-s`.
