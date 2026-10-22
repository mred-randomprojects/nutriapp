import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appDataFromRaw,
  CLOUD_DOC_LIMIT_BYTES,
  cloudDocBytes,
  firestoreValueSize,
  payloadFromAppData,
} from "./cloudDoc.js";
import type { AppData, LogEntryId, ProfileId } from "./types.js";

const EMPTY: AppData = {
  foods: [],
  profiles: [],
  activeProfileId: null,
  deletedDayLogEntries: [],
  deletedFoods: [],
  deletedProfiles: [],
};

describe("firestoreValueSize: Firestore's storage sizes", () => {
  it("counts strings as UTF-8 bytes + 1, numbers as 8, booleans and null as 1", () => {
    assert.equal(firestoreValueSize("abc"), 4);
    assert.equal(firestoreValueSize("ñ"), 3);
    assert.equal(firestoreValueSize("🍎"), 5);
    assert.equal(firestoreValueSize(82.4), 8);
    assert.equal(firestoreValueSize(true), 1);
    assert.equal(firestoreValueSize(null), 1);
  });

  it("counts maps as their field names + 1 and values, arrays as their values, and skips undefined", () => {
    assert.equal(firestoreValueSize({ a: 1, bb: "x", gone: undefined }), 2 + 8 + 3 + 2);
    assert.equal(firestoreValueSize([1, "x", null]), 8 + 2 + 1);
  });

  it("sizes a document like Firestore's own example (name, fields, 32 bytes)", () => {
    // users/u/data/appData: 6 + 2 + 5 + 8 + 16 = 37 bytes of name.
    const bytes = cloudDocBytes("u", EMPTY);
    const fields =
      "foods".length + 1 +
      "profiles".length + 1 +
      "activeProfileId".length + 1 + 1 +
      "deletedDayLogEntries".length + 1 +
      "deletedFoods".length + 1 +
      "deletedProfiles".length + 1;
    assert.equal(bytes, 37 + fields + 32);
    assert.ok(CLOUD_DOC_LIMIT_BYTES === 1024 * 1024);
  });
});

describe("appDataFromRaw / payloadFromAppData", () => {
  it("reads a missing or malformed field as empty, and only the six fields", () => {
    const data = appDataFromRaw({
      foods: "garbage",
      profiles: { a: 1 },
      activeProfileId: 7,
      deletedFoods: [{ foodId: "f", deletedAt: "2026-10-01T00:00:00.000Z" }],
      extra: "dropped",
    });
    assert.deepEqual(data, {
      ...EMPTY,
      deletedFoods: [{ foodId: "f", deletedAt: "2026-10-01T00:00:00.000Z" }],
    });
  });

  it("writes exactly the six fields, without undefined values anywhere", () => {
    const payload = payloadFromAppData({
      ...EMPTY,
      activeProfileId: "p1" as ProfileId,
      deletedDayLogEntries: [
        {
          profileId: "p1" as ProfileId,
          date: "2026-10-01",
          entryId: "e1" as LogEntryId,
          deletedAt: "2026-10-01T00:00:00.000Z",
          restoredAt: undefined,
        },
      ],
    });
    assert.deepEqual(Object.keys(payload).sort(), [
      "activeProfileId",
      "deletedDayLogEntries",
      "deletedFoods",
      "deletedProfiles",
      "foods",
      "profiles",
    ]);
    assert.equal(JSON.stringify(payload).includes("restoredAt"), false);
  });
});
