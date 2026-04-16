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

- **Built-in foods** ship as static JSON in the bundle (`src/data/foods.json`)
- **User data** (custom foods, profiles, day logs) is stored in both:
  - **localStorage** — immediate reads/writes, works offline
  - **Firestore** — async cloud sync for cross-device access
- On app load, data from Firestore and localStorage is **merged** (union of both, no data is ever discarded)
- Firestore document path: `users/{uid}/data/appData`

## Future Features

- [ ] **Argentinian food database** — curate a comprehensive database of common Argentinian foods with accurate nutrition info. Users can optionally subscribe to the full database or cherry-pick individual items from it into their personal food list.
- [ ] **AI food recognition from photos** — take a picture of a food item and have an AI model automatically identify the food, estimate its name, and fill in nutrition info (calories, protein, fat, fiber, etc.). This would streamline the food-creation flow significantly.
- [ ] **Storage support** — add Firebase Storage (or equivalent) for storing user-uploaded files such as food photos.
