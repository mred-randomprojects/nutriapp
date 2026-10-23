# NutriApp

Personal nutrition tracking app. Built with React, TypeScript, Vite, and Tailwind CSS. Data syncs across devices via Firebase.

## Local Development

```bash
npm install
npm run dev
```

## Firebase Setup

The app requires a Firebase project for authentication (Google Sign-In) and cloud storage (Firestore). Follow these steps to set it up from scratch.

### 1. Create a Firebase Project

1. Go to [console.firebase.google.com](https://console.firebase.google.com/) and sign in
2. Click **"Add project"**
3. Name it **`nutriapp`** (or whatever you prefer)
4. Disable Google Analytics (not needed)
5. Click **"Create project"**, wait for provisioning, then click **"Continue"**

### 2. Register a Web App

1. On the project overview page, click the **web icon** (`</>`)
2. Set the nickname to **`nutriapp-web`**
3. Do **not** enable Firebase Hosting
4. Click **"Register app"**
5. Copy the `firebaseConfig` values from the code snippet shown — you'll need them in step 3
6. Click **"Continue to console"**

### 3. Create the `.env` File

Create a `.env` file in the project root with the values from step 2:

```
VITE_FIREBASE_API_KEY=<apiKey>
VITE_FIREBASE_AUTH_DOMAIN=<authDomain>
VITE_FIREBASE_PROJECT_ID=<projectId>
VITE_FIREBASE_STORAGE_BUCKET=<storageBucket>
VITE_FIREBASE_MESSAGING_SENDER_ID=<messagingSenderId>
VITE_FIREBASE_APP_ID=<appId>
```

This file is gitignored. See `.env.example` for the template.

### 4. Enable Google Sign-In

1. In the Firebase console, go to **Authentication** (direct link: `https://console.firebase.google.com/project/<PROJECT_ID>/authentication`)
2. Click **"Get started"**
3. In the **"Sign-in method"** tab, click **"Google"**
4. Toggle **Enable** on
5. Set the public-facing name to **`NutriApp`**
6. Select your email as the support email
7. Click **"Save"**

### 5. Add Authorized Domains

Still in Authentication:

1. Click the **"Settings"** tab
2. Scroll to **"Authorized domains"**
3. Click **"Add domain"**
4. Add your GitHub Pages domain: **`<username>.github.io`**
5. Click **"Add"**

Without this, Google Sign-In will fail with `auth/unauthorized-domain` when running on GitHub Pages. For local development, `localhost` is already authorized by default.

### 6. Create the Firestore Database

1. In the Firebase console, go to **Firestore Database**
2. Click **"Create database"**
3. Select **"Standard edition"**, click Next
4. Leave Database ID as **`(default)`**
5. Pick the closest location (e.g. `southamerica-east1` for South America)
6. Select **"Start in production mode"**
7. Click **"Create"**

### 7. Set Firestore Security Rules

1. In Firestore Database, click the **"Rules"** tab
2. Replace all content with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

3. Click **"Publish"**

Each authenticated user can only read/write their own data under `users/{theirUid}/`.

## GitHub Pages Deployment

The app deploys automatically on push to `main` via GitHub Actions (`.github/workflows/deploy.yml`).

### Repository Secrets

The deploy workflow needs the same Firebase config values as environment variables. Add these as repository secrets at **Settings > Secrets and variables > Actions > New repository secret**:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

The values are the same as in your `.env` file.

## Data Architecture

- **Built-in foods** ship as static JSON in the bundle (`src/data/foods.json`, filled by
  `npm run add-food`). It is empty today: every food is a user food.
- **User data** (custom foods, profiles, day logs) is stored in both:
  - **localStorage** — immediate reads/writes, works offline
  - **Firestore** — async cloud sync for cross-device access, one document per user
- **Sync engine** (`src/syncEngine.ts`, merge rules in `src/syncMerge.ts`). Every change is
  written to this device at once and remembered as *pending* (`nutriapp-sync:<uid>`, each
  mark with a fingerprint of the version it is for) until a cloud write carries it, so a
  reload or relaunch never forgets what the cloud lacks.
  - **Merging:** for anything both sides have, the cloud's version wins, except this
    device's pending changes, which win. Entries, foods, profiles, days and saved meal plans
    merge one by one; only a tombstone removes an entry, food or profile, so a copy that
    simply lacks something (an old build's whole-document write, a stale device) never
    deletes it.
  - **Writes** are Firestore transactions that read the server's copy and write the merge on
    top of it (nothing when it already holds everything). A write can never replace the
    cloud copy with an older one, even before the sign-in read, offline at launch, or while
    another device writes.
  - **Reads** come from the server only (`getDocFromServer`): on sign-in, whenever the window
    regains focus or becomes visible, and when the browser comes back online. A failed read
    or write is retried with backoff (5 s up to 5 min) and shown in the pill above the storage
    meter; a write refused because the document would pass Firestore's 1 MiB is shown and only
    tried again by the next edit.
  - **Upgrade:** the first successful pull on a device after moving from the previous build
    marks the values only its local copy has and the cloud lacks (a weight plan, metrics, meal
    plans, the weekly plan, a weight) as this device's changes, as the previous build would
    have filled them in; once only (`filled` in `nutriapp-sync:<uid>`), so a value cleared
    elsewhere later stays cleared.
  - **Tabs** of one browser merge each other's writes from the `storage` event, so neither
    drops what the other logged.
  - **Full storage:** when the shared origin's `localStorage` is full, edits keep going to the
    cloud from memory; a mark is only stored together with the version it is for, so a
    relaunch never lets an older local copy win.
- **New builds:** each build knows its commit (`__APP_COMMIT__`, from `GITHUB_SHA` in CI;
  `dev` locally) and the deploy publishes the live one in `version.json`. When the app comes
  back into view, when the network returns, and every 30 minutes while it is in view, it
  fetches `version.json` (`cache: "no-store"`); on a newer build it reloads at once if the
  person just came back and nothing is being edited (no unsaved form, dialog, text focus, and
  the local copy fully stored), and otherwise shows a "New version available — reload" pill.
  This is what moves the Dock app, which stays open for days, onto new builds.
- **Safety copy:** when a pull takes something away from this device that no tombstone
  explains (entries, foods or profiles without a delete, weights, meal plans: an older build
  writing its older copy, a bad write; ordinary deletes on another device do not count), the data from just before is kept in IndexedDB (`nutriapp-safety`) and a banner
  says what went, with **Restore it** (brings back what is missing, everywhere, as one undoable
  action) and **Dismiss**. A second loss is added to the same copy; it goes away by itself once
  nothing it holds is missing.
- **Backup:** Account → **Download backup (JSON)** saves exactly what the `nutriapp-data` key
  holds, as `nutriapp-backup-YYYY-MM-DD.json`. There is no import.
- Firestore document path: `users/{uid}/data/appData`

## Future Features

- [ ] **Argentinian food database** — curate a comprehensive database of common Argentinian foods with accurate nutrition info. Users can optionally subscribe to the full database or cherry-pick individual items from it into their personal food list.
- [ ] **AI food recognition from photos** — take a picture of a food item and have an AI model automatically identify the food, estimate its name, and fill in nutrition info (calories, protein, fat, fiber, etc.). This would streamline the food-creation flow significantly.
- [ ] **Storage support** — add Firebase Storage (or equivalent) for storing user-uploaded files such as food photos.
- [ ] **Weekly/monthly summary view** — show average daily calories, protein, sat. fat, and fiber over the last 7 or 30 days. Give users a feedback loop that makes tracking feel worthwhile instead of each day being an island.
- [ ] **Nutrition targets / goals** — let users set calorie/protein/fiber targets per profile, and show progress bars or color-coding (green = on track, red = over) in the daily totals card.
- [ ] **Cloud sync status indicator** — show a small cloud icon (checkmark/spinner/warning) so users know whether their data is synced, syncing, or failed. Today a pill above the storage meter shows "Saving…"/"Saved" after each change, and failures.

## Installed app appearance

`public/manifest.webmanifest` supplies the NutriApp name, standalone window,
start URL, scope, theme, and install icons. URLs are relative to the manifest,
and HTML links use Vite's `%BASE_URL%`, so development at `/` and GitHub Pages
at `/nutriapp/` both resolve correctly. The React hash routes stay within that
scope.

The PNG icons preserve the original salad-emoji favicon on the app's dark
background. Sizes include a 32px favicon, a 180px Apple touch icon, 192/512/1024px
install icons, and a separate maskable icon with extra safe-area padding.
Generated PNGs are committed; Linux/CI builds require no icon-generation tools.
To regenerate them on macOS:

```sh
swift scripts/generate-app-icons.swift public/icons
```

After deploying, open the website in Safari and choose **File → Add to Dock**.
For an already installed Safari web app, open **NutriApp → Settings → General
→ Icon** and select `public/icons/icon-1024.png` to update its appearance while
keeping its existing login, data, and application identity. Other browsers may
refresh installed metadata on their own schedule.

This adds install metadata and branding. It does not add a service worker or
change the app's existing storage/sync behavior.

## Estimating a quick-add from the terminal

`npm run nutri -- show <date>` lists a day's entries (with their ids), and
`npm run nutri -- estimate <date> <entry-id> --kcal N [--protein N --satfat N --fiber N --note "…"] --write`
fills in the nutrition of a quick-add logged "to estimate later", straight on the
cloud document (auth: your `gcloud` login). Without `--write` it is a dry run. It
only touches unestimated quick-adds (`--force` to replace an estimate), saves the
whole document to `~/.nutriapp/backups/` first, writes with the document's update
time as a precondition (if the app saved in between, nothing is written), and
checks that the one entry is all that changed. The app takes it on its next sync.
Code: `cli/nutri.ts`, `src/estimateEntry.ts`.
