#!/usr/bin/env node

/**
 * Tests firestore.rules against every path the client uses (ALLOW) and every
 * attack we know of (DENY), through the Firebase Rules API `:test` endpoint.
 * It only evaluates the rules sent with the request: nothing is published and
 * no data is read or written.
 *
 * Usage:
 *   npm run test:rules
 *   node scripts/rules-test.mjs [--rules path/to/firestore.rules] [--payload-out out.json]
 *
 * Needs `gcloud` signed in with access to the project (RULES_PROJECT, default
 * nutriapp-9ac19). Exits 1 if any case does not get the expected result.
 */

import { execFileSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = process.env.RULES_PROJECT ?? "nutriapp-9ac19";

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const RULES_PATH = resolve(argValue("--rules") ?? resolve(__dirname, "../firestore.rules"));
const PAYLOAD_OUT = argValue("--payload-out");

const MAX = "maxUid";
const MARISOL = "marisolUid";
const EVIL = "evilUid";
const MAX_EMAIL = "maxiredigonda@gmail.com";
const MARISOL_EMAIL = "marisolpaez227@gmail.com";
const DB = "/databases/(default)/documents";

function token(uid, email, { verified = true, provider = "google.com", omitVerified = false } = {}) {
  const claims = { firebase: { sign_in_provider: provider } };
  if (email != null) {
    claims.email = email;
    if (!omitVerified) claims.email_verified = verified;
  }
  return { uid, token: claims };
}

const AS_MAX = token(MAX, MAX_EMAIL);
const AS_MARISOL = token(MARISOL, MARISOL_EMAIL);
const AS_STRANGER = token(EVIL, "stranger@gmail.com");
const AS_ANONYMOUS = { uid: "anonUid", token: { firebase: { sign_in_provider: "anonymous" } } };

const appDataPath = (uid) => `${DB}/users/${uid}/data/appData`;

// What payloadFromAppData() writes (src/cloudStorage.ts), in the app's own shapes.
const EMPTY = {
  foods: [],
  profiles: [],
  activeProfileId: null,
  deletedDayLogEntries: [],
  deletedFoods: [],
  deletedProfiles: [],
};
// Local data saved before the tombstone fields existed: they are undefined and stripped.
const LEGACY = { foods: [], profiles: [], activeProfileId: null };

function food(id) {
  return {
    id,
    name: `Food ${id}`,
    imageUrl: "https://images.openfoodfacts.org/images/products/x/front_es.4.400.jpg",
    nutritionPer100g: { calories: 389, protein: 16.9, saturatedFat: 1.2, fiber: 10.6 },
    nutritionPerUnit: null,
    gramsPerUnit: 40,
    ingredients: null,
    createdAt: "2026-04-08T12:00:00.000Z",
  };
}

function dayLog(date, entries) {
  return {
    date,
    weightKg: 82.4,
    entries: Array.from({ length: entries }, (_, i) =>
      i % 6 === 0
        ? { type: "separator", id: `${date}-s${i}`, label: "Lunch" }
        : i % 6 === 5
          ? {
              type: "quick-add",
              id: `${date}-q${i}`,
              name: "Coffee",
              nutrition: { calories: 5, protein: 0, saturatedFat: 0, fiber: 0 },
              isBudgeted: true,
            }
          : { id: `${date}-e${i}`, foodId: "f1", grams: 80, units: 2, notes: "after run" },
    ),
  };
}

function appData({ foods = 1, days = 1, entriesPerDay = 6, tombstones = 1 } = {}) {
  const dates = Array.from({ length: days }, (_, i) =>
    new Date(Date.UTC(2026, 3, 1) + i * 86_400_000).toISOString().slice(0, 10),
  );
  return {
    foods: Array.from({ length: foods }, (_, i) => food(`f${i + 1}`)),
    profiles: [
      {
        id: "p1",
        name: "Max",
        dayLogs: dates.map((date) => dayLog(date, entriesPerDay)),
        createdAt: "2026-04-08T12:00:00.000Z",
        goals: { calories: 2200, protein: 160, saturatedFat: 10, saturatedFatMode: "percentage", fiber: 30 },
        schedule: { wakeHour: 7, sleepHour: 23 },
        userMetrics: null,
        weightLossPlan: { startDate: "2026-04-01", startWeightKg: 90, targetWeightKg: 80, weeklyLossRateKg: 0.5 },
        mealPlans: [
          {
            id: "m1",
            name: "Cut",
            description: "Weekdays",
            entries: [{ id: "m1-e1", foodId: "f1", grams: 80, isBudgeted: true }],
            createdAt: "2026-05-01T00:00:00.000Z",
            updatedAt: "2026-10-01T00:00:00.000Z",
          },
        ],
        weeklyPlan: {},
      },
    ],
    activeProfileId: "p1",
    deletedDayLogEntries: Array.from({ length: tombstones }, (_, i) => ({
      profileId: "p1",
      date: dates[i % dates.length],
      entryId: `gone-${i}`,
      deletedAt: "2026-10-15T10:00:00.000Z",
      ...(i % 10 === 0 ? { restoredAt: "2026-10-15T10:01:00.000Z" } : {}),
    })),
    deletedFoods: [{ foodId: "f0", deletedAt: "2026-10-01T00:00:00.000Z" }],
    deletedProfiles: [{ profileId: "p0", deletedAt: "2026-09-01T00:00:00.000Z" }],
  };
}

const REAL = appData();
// Bigger than the real document today (its size estimate is printed below).
const PRODUCTION_SIZE = appData({ foods: 150, days: 240, entriesPerDay: 26, tombstones: 2400 });

const ALLOW = "ALLOW";
const DENY = "DENY";

function testCase(id, description, expectation, { auth, path, method, write, existing }) {
  const request = { path, method };
  if (auth != null) request.auth = auth;
  if (write != null) request.resource = { data: write };
  const tc = { expectation, request };
  if (existing != null) tc.resource = { data: existing };
  return { id, description, tc };
}

const CASES = [
  // Every operation the client performs (src/cloudStorage.ts).
  testCase("L1", "Max reads his document (sign-in and return pulls, transaction.get)", ALLOW, { auth: AS_MAX, path: appDataPath(MAX), method: "get", existing: REAL }),
  testCase("L2", "Max reads his document before it exists", ALLOW, { auth: AS_MAX, path: appDataPath(MAX), method: "get" }),
  testCase("L3", "Max's first upload (transaction.set on a missing document)", ALLOW, { auth: AS_MAX, path: appDataPath(MAX), method: "create", write: REAL }),
  testCase("L4", "Max creates it from empty local data", ALLOW, { auth: AS_MAX, path: appDataPath(MAX), method: "create", write: EMPTY }),
  testCase("L5", "Max creates it from legacy local data (tombstone fields stripped)", ALLOW, { auth: AS_MAX, path: appDataPath(MAX), method: "create", write: LEGACY }),
  testCase("L6", "Max saves (transaction.set over the existing document)", ALLOW, { auth: AS_MAX, path: appDataPath(MAX), method: "update", write: REAL, existing: EMPTY }),
  testCase("L7", "Max saves over a legacy-shaped document", ALLOW, { auth: AS_MAX, path: appDataPath(MAX), method: "update", write: EMPTY, existing: { ...LEGACY, oldField: 1 } }),
  testCase("L8", "Marisol reads her document", ALLOW, { auth: AS_MARISOL, path: appDataPath(MARISOL), method: "get", existing: EMPTY }),
  testCase("L9", "Marisol creates her document", ALLOW, { auth: AS_MARISOL, path: appDataPath(MARISOL), method: "create", write: EMPTY }),
  testCase("L10", "Marisol saves her document", ALLOW, { auth: AS_MARISOL, path: appDataPath(MARISOL), method: "update", write: REAL, existing: EMPTY }),
  testCase("L11", "Max saves a production-size document", ALLOW, { auth: AS_MAX, path: appDataPath(MAX), method: "update", write: PRODUCTION_SIZE, existing: PRODUCTION_SIZE }),
  testCase("L12", "Max saves a document that lost most of its tombstones", ALLOW, { auth: AS_MAX, path: appDataPath(MAX), method: "update", write: { ...REAL, deletedDayLogEntries: [] }, existing: PRODUCTION_SIZE }),
  // Outsiders and the other allowlisted account.
  testCase("X1", "unauthenticated read of Max's document", DENY, { path: appDataPath(MAX), method: "get", existing: REAL }),
  testCase("X2", "unauthenticated overwrite of Max's document", DENY, { path: appDataPath(MAX), method: "update", write: EMPTY, existing: REAL }),
  testCase("X3", "another Google account reads Max's document", DENY, { auth: AS_STRANGER, path: appDataPath(MAX), method: "get", existing: REAL }),
  testCase("X4", "another Google account overwrites Max's document", DENY, { auth: AS_STRANGER, path: appDataPath(MAX), method: "update", write: EMPTY, existing: REAL }),
  testCase("X5", "another Google account creates its own document (not allowlisted)", DENY, { auth: AS_STRANGER, path: appDataPath(EVIL), method: "create", write: EMPTY }),
  testCase("X6", "another Google account writes junk under its own uid", DENY, { auth: AS_STRANGER, path: `${DB}/users/${EVIL}/junk/j1`, method: "create", write: { blob: "x" } }),
  testCase("X7", "Marisol reads Max's document", DENY, { auth: AS_MARISOL, path: appDataPath(MAX), method: "get", existing: REAL }),
  testCase("X8", "Marisol overwrites Max's document", DENY, { auth: AS_MARISOL, path: appDataPath(MAX), method: "update", write: EMPTY, existing: REAL }),
  testCase("X9", "Marisol deletes Max's document", DENY, { auth: AS_MARISOL, path: appDataPath(MAX), method: "delete", existing: REAL }),
  testCase("X10", "anonymous session on its own path", DENY, { auth: AS_ANONYMOUS, path: appDataPath("anonUid"), method: "create", write: EMPTY }),
  testCase("X11", "Max's email in a token for another uid, on Max's path", DENY, { auth: token(EVIL, MAX_EMAIL), path: appDataPath(MAX), method: "get", existing: REAL }),
  testCase("X12", "listing another user's data (enumeration)", DENY, { auth: AS_MAX, path: appDataPath(EVIL), method: "list" }),
  testCase("X13", "a top-level collection outside /users", DENY, { auth: AS_MAX, path: `${DB}/other/x`, method: "create", write: { a: 1 } }),
  testCase("X14", "an allowlisted email in another case", DENY, { auth: token(MAX, "MaxiRedigonda@gmail.com"), path: appDataPath(MAX), method: "get", existing: REAL }),
  // Allowlisted email without a verified Google identity.
  testCase("V1", "allowlisted email with email_verified=false", DENY, { auth: token(EVIL, MARISOL_EMAIL, { verified: false }), path: appDataPath(EVIL), method: "create", write: EMPTY }),
  testCase("V2", "allowlisted email without an email_verified claim", DENY, { auth: token(EVIL, MARISOL_EMAIL, { omitVerified: true }), path: appDataPath(EVIL), method: "create", write: EMPTY }),
  testCase("V3", "allowlisted email from the password provider, unverified", DENY, { auth: token(EVIL, MARISOL_EMAIL, { verified: false, provider: "password" }), path: `${DB}/users/${EVIL}/junk/j1`, method: "create", write: { blob: "x" } }),
  testCase("V4", "allowlisted verified email from another provider", DENY, { auth: token(EVIL, MARISOL_EMAIL, { provider: "github.com" }), path: appDataPath(EVIL), method: "create", write: EMPTY }),
  testCase("V5", "Max's own uid and email, but signed in with another provider", DENY, { auth: token(MAX, MAX_EMAIL, { provider: "password" }), path: appDataPath(MAX), method: "get", existing: REAL }),
  // What an allowlisted session (a stolen one, or a buggy build) must not do.
  testCase("O1", "Max deletes his document (the client never deletes)", DENY, { auth: AS_MAX, path: appDataPath(MAX), method: "delete", existing: REAL }),
  testCase("O2", "Max lists users/{uid}/data (the client never lists)", DENY, { auth: AS_MAX, path: appDataPath(MAX), method: "list" }),
  testCase("O3", "Max creates junk documents in a new subcollection", DENY, { auth: AS_MAX, path: `${DB}/users/${MAX}/junk/j1`, method: "create", write: { blob: "x".repeat(1000) } }),
  testCase("O4", "Max writes the parent users/{uid} document", DENY, { auth: AS_MAX, path: `${DB}/users/${MAX}`, method: "create", write: { a: 1 } }),
  testCase("O5", "Max writes a document nested under appData", DENY, { auth: AS_MAX, path: `${DB}/users/${MAX}/data/appData/x/y`, method: "create", write: { a: 1 } }),
  testCase("O6", "Max writes a second document in data/", DENY, { auth: AS_MAX, path: `${DB}/users/${MAX}/data/other`, method: "create", write: EMPTY }),
  testCase("O7", "appData with an unknown extra field", DENY, { auth: AS_MAX, path: appDataPath(MAX), method: "update", write: { ...EMPTY, evil: "x" }, existing: REAL }),
  testCase("O8", "appData with foods as a string", DENY, { auth: AS_MAX, path: appDataPath(MAX), method: "update", write: { ...EMPTY, foods: "garbage" }, existing: REAL }),
  testCase("O9", "appData with profiles as a map", DENY, { auth: AS_MAX, path: appDataPath(MAX), method: "update", write: { ...EMPTY, profiles: { a: 1 } }, existing: REAL }),
  testCase("O10", "appData with activeProfileId as a number", DENY, { auth: AS_MAX, path: appDataPath(MAX), method: "update", write: { ...EMPTY, activeProfileId: 7 }, existing: REAL }),
  testCase("O11", "appData with a tombstone list as a string", DENY, { auth: AS_MAX, path: appDataPath(MAX), method: "update", write: { ...EMPTY, deletedDayLogEntries: "x" }, existing: REAL }),
  testCase("O12", "Max lists users/{uid} itself", DENY, { auth: AS_MAX, path: `${DB}/users/${MAX}`, method: "list" }),
  testCase("O13", "Max creates appData with a junk field (create, not update)", DENY, { auth: AS_MAX, path: appDataPath(MAX), method: "create", write: { ...EMPTY, junk: "x".repeat(1000) } }),
];

/** Firestore's storage-size estimate of a value (the 1 MiB limit is in these units). */
function firestoreSize(value) {
  if (value == null || typeof value === "boolean") return 1;
  if (typeof value === "number") return 8;
  if (typeof value === "string") return Buffer.byteLength(value) + 1;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + firestoreSize(item), 0);
  return Object.entries(value).reduce((sum, [key, item]) => sum + Buffer.byteLength(key) + 1 + firestoreSize(item), 0);
}

async function main() {
  const rules = readFileSync(RULES_PATH, "utf8");
  const payload = {
    source: { files: [{ name: "firestore.rules", content: rules }] },
    testSuite: { testCases: CASES.map((c) => c.tc) },
  };
  if (PAYLOAD_OUT != null) writeFileSync(PAYLOAD_OUT, JSON.stringify(payload, null, 1));

  const accessToken = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
  const response = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "x-goog-user-project": PROJECT,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) {
    console.error(`Rules API ${response.status}:`, JSON.stringify(body, null, 1).slice(0, 4000));
    process.exit(1);
  }
  if (body.issues != null && body.issues.length > 0) {
    console.error("The rules do not compile:", JSON.stringify(body.issues, null, 1));
    process.exit(1);
  }

  const results = body.testResults ?? [];
  let passed = 0;
  CASES.forEach((c, index) => {
    const state = results[index]?.state ?? "MISSING";
    if (state === "SUCCESS") passed += 1;
    const detail =
      state === "SUCCESS" ? "" : ` | ${(results[index]?.debugMessages ?? []).join("; ")}`;
    console.log(`${state === "SUCCESS" ? "ok  " : "FAIL"} ${c.id.padEnd(4)} ${c.tc.expectation.padEnd(5)} ${c.description}${detail}`);
  });
  console.log(
    `${passed}/${CASES.length} as expected (${RULES_PATH}; production-size case ≈ ${Math.round(firestoreSize(PRODUCTION_SIZE) / 1024)} KB)`,
  );
  if (passed !== CASES.length || results.length !== CASES.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
