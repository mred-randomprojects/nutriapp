import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LOCAL_OWNER_KEY,
  loadAppData,
  localKeysFor,
  saveAppData,
} from "./storage.js";
import { planCloudPull } from "./mergeAppData.js";
import type { AppData, Profile, ProfileId } from "./types.js";

function memoryStorage(entries: Record<string, string> = {}): Storage & { map: Map<string, string> } {
  const map = new Map(Object.entries(entries));
  return {
    map,
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

function profile(id: string): Profile {
  return {
    id: id as ProfileId,
    name: id,
    dayLogs: [],
    createdAt: "2026-04-08T12:00:00.000Z",
    goals: null,
    schedule: null,
    userMetrics: null,
    weightLossPlan: null,
    mealPlans: [],
    weeklyPlan: {},
  };
}

function data(...profileIds: string[]): AppData {
  return {
    foods: [],
    profiles: profileIds.map(profile),
    activeProfileId: (profileIds[0] ?? null) as ProfileId | null,
    deletedDayLogEntries: [],
    deletedFoods: [],
    deletedProfiles: [],
  };
}

const profileIds = (d: AppData) => d.profiles.map((p) => p.id);

describe("localKeysFor: the local copy belongs to one account", () => {
  it("lets the account signed in now claim an existing install's data (no marker yet)", () => {
    const storage = memoryStorage({ "nutriapp-data": JSON.stringify(data("p-max")) });
    const keys = localKeysFor("uid-max", storage);
    assert.equal(keys.data, "nutriapp-data");
    assert.equal(storage.getItem(LOCAL_OWNER_KEY), "uid-max");
    assert.deepEqual(profileIds(loadAppData(keys, storage)), ["p-max"]);
  });

  it("gives another account keys of its own: it starts empty and never reads the owner's data", () => {
    const storage = memoryStorage({ "nutriapp-data": JSON.stringify(data("p-max")) });
    localKeysFor("uid-max", storage);

    const other = localKeysFor("uid-marisol", storage);
    assert.equal(other.data, "nutriapp-data:uid-marisol");
    assert.equal(other.backup, "nutriapp-data-backup:uid-marisol");
    assert.equal(other.corruptRecovery, "nutriapp-data-corrupt-recovery:uid-marisol");
    assert.deepEqual(profileIds(loadAppData(other, storage)), []);
  });

  it("sets the owner's copy aside untouched while the other account works, and hands it back", () => {
    const maxData = JSON.stringify(data("p-max"));
    const storage = memoryStorage({ "nutriapp-data": maxData, "nutriapp-data-backup": maxData });
    localKeysFor("uid-max", storage);

    const marisol = localKeysFor("uid-marisol", storage);
    saveAppData(marisol, data("p-marisol"), storage);
    saveAppData(marisol, data("p-marisol", "p-marisol-2"), storage);

    assert.equal(storage.getItem("nutriapp-data"), maxData);
    assert.equal(storage.getItem("nutriapp-data-backup"), maxData);
    assert.equal(storage.getItem(LOCAL_OWNER_KEY), "uid-max");
    assert.deepEqual(profileIds(loadAppData(localKeysFor("uid-max", storage), storage)), ["p-max"]);
    assert.deepEqual(profileIds(loadAppData(localKeysFor("uid-marisol", storage), storage)), [
      "p-marisol",
      "p-marisol-2",
    ]);
  });

  it("never lets the second account's sign-in pull carry the first account's data", () => {
    // nutriapp-account-switch-merge: A signs out, B signs in on the same browser.
    const storage = memoryStorage({ "nutriapp-data": JSON.stringify(data("p-max")) });
    localKeysFor("uid-max", storage);

    const local = loadAppData(localKeysFor("uid-marisol", storage), storage);
    const marisolCloud = data();
    const plan = planCloudPull(local, marisolCloud);
    assert.equal(plan.cloudChanged, false, "nothing to upload into her account");
    assert.deepEqual(profileIds(plan.merged), []);
  });

  it("lets the first account to sign in on a fresh browser own the unsuffixed keys", () => {
    const storage = memoryStorage();
    assert.equal(localKeysFor("uid-marisol", storage).data, "nutriapp-data");
    assert.equal(localKeysFor("uid-max", storage).data, "nutriapp-data:uid-max");
  });
});

describe("loadAppData", () => {
  it("starts empty instead of throwing when storage is blocked", () => {
    const blocked = memoryStorage();
    blocked.getItem = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    const keys = localKeysFor("uid-max", blocked);
    assert.deepEqual(loadAppData(keys, blocked), data());
  });

  it("keeps a corrupt copy aside and falls back to the backup, per account", () => {
    const storage = memoryStorage();
    localKeysFor("uid-max", storage);
    const marisol = localKeysFor("uid-marisol", storage);
    storage.setItem(marisol.data, "{not json");
    storage.setItem(marisol.backup, JSON.stringify(data("p-marisol")));

    assert.deepEqual(profileIds(loadAppData(marisol, storage)), ["p-marisol"]);
    assert.equal(storage.getItem(marisol.corruptRecovery), "{not json");
    assert.equal(storage.getItem("nutriapp-data-corrupt-recovery"), null);
  });

  it("never rolls a corrupt copy over the good backup it fell back to", () => {
    const storage = memoryStorage();
    const keys = localKeysFor("uid-max", storage);
    storage.setItem(keys.data, "{not json");
    storage.setItem(keys.backup, JSON.stringify(data("p-good")));
    const loaded = loadAppData(keys, storage);
    // The first save after the fallback: the corrupt copy must not take the backup slot.
    saveAppData(keys, { ...loaded, activeProfileId: null }, storage);
    assert.deepEqual(profileIds(JSON.parse(storage.getItem(keys.backup) ?? "null") as AppData), ["p-good"]);
  });

  it("falls back to the backup when the copy itself is missing", () => {
    // Removed by something else on the shared origin: the backup is the
    // newest copy there is, and starting empty would roll that empty copy
    // over it at the second save.
    const storage = memoryStorage();
    const keys = localKeysFor("uid-max", storage);
    storage.setItem(keys.backup, JSON.stringify(data("p-backup")));
    assert.deepEqual(profileIds(loadAppData(keys, storage)), ["p-backup"]);
  });
});
