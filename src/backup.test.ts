import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { backupFileName, serializeBackup } from "./backup.js";
import type { AppData, FoodId, LogEntryId, ProfileId } from "./types.js";

// The file name must use the local calendar day: at 22:30 in Buenos Aires
// (UTC-3) it is already tomorrow in UTC. Set before the first Date is created.
process.env.TZ = "America/Argentina/Buenos_Aires";

const DATA: AppData = {
  foods: [
    {
      id: "f1" as FoodId,
      name: "Oats",
      imageUrl: null,
      nutritionPer100g: { calories: 389, protein: 16.9, saturatedFat: 1.2, fiber: 10.6 },
      nutritionPerUnit: null,
      gramsPerUnit: 40,
      ingredients: null,
      createdAt: "2026-04-08T12:00:00.000Z",
    },
  ],
  profiles: [
    {
      id: "p1" as ProfileId,
      name: "Max",
      dayLogs: [
        {
          date: "2026-10-09",
          entries: [{ id: "e1" as LogEntryId, foodId: "f1" as FoodId, grams: 80 }],
          weightKg: 82.4,
        },
      ],
      createdAt: "2026-04-08T12:00:00.000Z",
      goals: null,
      schedule: { wakeHour: 7, sleepHour: 23 },
      userMetrics: null,
      weightLossPlan: null,
    },
  ],
  activeProfileId: "p1" as ProfileId,
  deletedDayLogEntries: [
    {
      profileId: "p1" as ProfileId,
      date: "2026-10-08",
      entryId: "e0" as LogEntryId,
      deletedAt: "2026-10-08T20:00:00.000Z",
    },
  ],
  deletedFoods: [],
  deletedProfiles: [],
};

describe("serializeBackup", () => {
  it("writes exactly what the nutriapp-data key holds", () => {
    assert.equal(serializeBackup(DATA), JSON.stringify(DATA));
  });

  it("parses back to the same data, tombstones included", () => {
    assert.deepEqual(JSON.parse(serializeBackup(DATA)), DATA);
  });
});

describe("backupFileName", () => {
  it("is dated with the local day, even late at night", () => {
    const lateEvening = new Date(2026, 9, 9, 22, 30);
    assert.equal(lateEvening.toISOString().slice(0, 10), "2026-10-10");
    assert.equal(backupFileName(lateEvening), "nutriapp-backup-2026-10-09.json");
  });

  it("pads month and day", () => {
    assert.equal(backupFileName(new Date(2027, 0, 5, 9, 0)), "nutriapp-backup-2027-01-05.json");
  });
});
