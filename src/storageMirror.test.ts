import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MirroredStorage, isMirroredKey, type MirrorBackend } from "./storageMirror.js";
import { SyncEngine } from "./syncEngine.js";
import { FakeCloud, FakeServer, FakeStorage, ManualTimers, settle } from "./syncTestKit.js";
import type { AppData, FoodId, ProfileId } from "./types.js";

/** The IndexedDB stand-in: async like the real one, and able to fail. */
class FakeMirror implements MirrorBackend {
  readonly records = new Map<string, string>();
  /** Every value it ever stored, per key: nothing may vanish from here. */
  readonly history = new Map<string, string[]>();
  failing = false;
  puts = 0;

  async put(key: string, read: () => string | null): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
    if (this.failing) throw new Error("IndexedDB is down");
    const value = read();
    if (value == null) return;
    this.records.set(key, value);
    this.history.set(key, [...(this.history.get(key) ?? []), value]);
    this.puts += 1;
  }

  async getAll(): Promise<Map<string, string>> {
    await new Promise((resolve) => setImmediate(resolve));
    if (this.failing) throw new Error("IndexedDB is down");
    return new Map(this.records);
  }
}

function snapshotOf(storage: Storage): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key != null) map.set(key, storage.getItem(key) ?? "");
  }
  return map;
}

describe("MirroredStorage", () => {
  it("writes localStorage as before and copies NutriApp's keys to the mirror", async () => {
    const base = new FakeStorage();
    const mirror = new FakeMirror();
    const storage = new MirroredStorage(base, mirror, isMirroredKey);

    storage.setItem("nutriapp-data", "v1");
    storage.setItem("fulbito-data", "theirs");
    assert.equal(base.getItem("nutriapp-data"), "v1");
    assert.equal(base.getItem("fulbito-data"), "theirs");

    await storage.flush();
    assert.deepEqual([...mirror.records], [["nutriapp-data", "v1"]]);
  });

  it("ends on localStorage's latest value, one write per burst", async () => {
    const base = new FakeStorage();
    const mirror = new FakeMirror();
    const storage = new MirroredStorage(base, mirror, isMirroredKey);

    for (let i = 1; i <= 10; i++) storage.setItem("nutriapp-data", `v${i}`);
    await storage.flush();
    assert.equal(mirror.records.get("nutriapp-data"), "v10");
    assert.equal(mirror.puts, 1);
  });

  it("copies what another tab wrote after this one, not this tab's older value", async () => {
    const base = new FakeStorage();
    const mirror = new FakeMirror();
    const tabA = new MirroredStorage(base, mirror, isMirroredKey);
    const tabB = new MirroredStorage(base, mirror, isMirroredKey);

    tabA.setItem("nutriapp-data", "from A");
    tabB.setItem("nutriapp-data", "from B");
    await Promise.all([tabA.flush(), tabB.flush()]);
    assert.equal(mirror.records.get("nutriapp-data"), "from B");
  });

  it("fails a write exactly as localStorage does, and mirrors what it still holds", async () => {
    const base = new FakeStorage();
    const mirror = new FakeMirror();
    const storage = new MirroredStorage(base, mirror, isMirroredKey);
    storage.setItem("nutriapp-data", "kept");
    base.refuse = () => true;

    assert.throws(
      () => storage.setItem("nutriapp-data", "too big"),
      (e: unknown) => e instanceof DOMException && e.name === "QuotaExceededError",
    );
    await storage.flush();
    assert.equal(base.getItem("nutriapp-data"), "kept");
    assert.equal(mirror.records.get("nutriapp-data"), "kept");
  });

  it("never lets a failing mirror reach the caller or localStorage", async () => {
    const base = new FakeStorage();
    const mirror = new FakeMirror();
    mirror.failing = true;
    const errors: unknown[] = [];
    const storage = new MirroredStorage(base, mirror, isMirroredKey, (e) => errors.push(e));

    storage.setItem("nutriapp-data", "v1");
    await storage.flush();
    assert.equal(base.getItem("nutriapp-data"), "v1");
    assert.equal(errors.length, 1);

    // Back up: the next write copies again.
    mirror.failing = false;
    storage.setItem("nutriapp-data", "v2");
    await storage.flush();
    assert.equal(mirror.records.get("nutriapp-data"), "v2");
  });

  it("removes from localStorage only: the mirror keeps the last value", async () => {
    const base = new FakeStorage();
    const mirror = new FakeMirror();
    const storage = new MirroredStorage(base, mirror, isMirroredKey);
    storage.setItem("nutriapp-data-backup", "previous");
    await storage.flush();

    storage.removeItem("nutriapp-data-backup");
    await storage.flush();
    assert.equal(base.getItem("nutriapp-data-backup"), null);
    assert.equal(mirror.records.get("nutriapp-data-backup"), "previous");

    const report = await storage.copyAndVerify();
    assert.deepEqual(report.onlyInMirror, ["nutriapp-data-backup"]);
    assert.deepEqual(report.mismatched, []);
  });

  it("refuses to clear the shared origin's storage", () => {
    const base = new FakeStorage();
    base.setItem("fulbito-data", "theirs");
    const storage = new MirroredStorage(base, new FakeMirror(), isMirroredKey);
    assert.throws(() => storage.clear());
    assert.equal(base.getItem("fulbito-data"), "theirs");
  });
});

describe("the launch copy", () => {
  it("copies every NutriApp key already stored, and finds the copy identical", async () => {
    const base = new FakeStorage();
    base.setItem("nutriapp-data", JSON.stringify({ big: "x".repeat(100_000) }));
    base.setItem("nutriapp-data-backup", "previous");
    base.setItem("nutriapp-sync:uid", "{}");
    base.setItem("fulbito-data", "theirs");
    base.setItem("nutriapp:food-form-draft:new", "{}");
    const mirror = new FakeMirror();
    const storage = new MirroredStorage(base, mirror, isMirroredKey);

    const first = await storage.copyAndVerify(() => new Date("2026-10-29T12:00:00Z"));
    assert.equal(first.keys, 3);
    assert.equal(first.copied, 3);
    assert.deepEqual(first.mismatched, []);
    assert.equal(first.checkedAt, "2026-10-29T12:00:00.000Z");
    assert.equal(mirror.records.has("fulbito-data"), false);
    assert.equal(mirror.records.has("nutriapp:food-form-draft:new"), false);
    for (const key of ["nutriapp-data", "nutriapp-data-backup", "nutriapp-sync:uid"]) {
      assert.equal(mirror.records.get(key), base.getItem(key));
    }

    // The next launch finds nothing to copy.
    const second = await storage.copyAndVerify();
    assert.equal(second.copied, 0);
    assert.deepEqual(second.mismatched, []);
  });

  it("reports a difference it could not fix, without touching localStorage", async () => {
    const base = new FakeStorage();
    base.setItem("nutriapp-data", "v1");
    const before = snapshotOf(base);
    const mirror = new FakeMirror();
    // Writes vanish: the mirror never gets the value.
    mirror.put = async () => {};
    const storage = new MirroredStorage(base, mirror, isMirroredKey);

    const report = await storage.copyAndVerify();
    assert.deepEqual(report.mismatched, ["nutriapp-data"]);
    assert.deepEqual(snapshotOf(base), before);
  });
});

// --- the sync engine on a mirrored storage ----------------------------------

const UID = "uid-max";
const T0 = "2026-10-01T12:00:00.000Z";

function addFood(id: string) {
  return (d: AppData): AppData => ({
    ...d,
    foods: [
      ...d.foods,
      {
        id: id as FoodId,
        name: id,
        imageUrl: null,
        nutritionPer100g: { calories: 100, protein: 1, saturatedFat: 1, fiber: 1 },
        nutritionPerUnit: null,
        gramsPerUnit: null,
        ingredients: null,
        createdAt: T0,
      },
    ],
  });
}

function addProfile(id: string) {
  return (d: AppData): AppData => ({
    ...d,
    profiles: [
      ...d.profiles,
      {
        id: id as ProfileId,
        name: id,
        dayLogs: [],
        createdAt: T0,
        goals: null,
        schedule: null,
        userMetrics: null,
        weightLossPlan: null,
      },
    ],
    activeProfileId: d.activeProfileId ?? (id as ProfileId),
  });
}

/** Runs the same session on `storage`; returns what localStorage ends up holding. */
async function session(base: FakeStorage, storage: Storage, fullAt: number): Promise<void> {
  let clock = Date.parse(T0);
  const engine = new SyncEngine({
    uid: UID,
    cloud: new FakeCloud(new FakeServer(), "mac"),
    storage,
    schedule: new ManualTimers().schedule,
    now: () => (clock += 1000),
    stampNonce: "tab1",
  });
  engine.start();
  await settle();
  const steps = [addProfile("p1"), addFood("f1"), addFood("f2"), addFood("f3"), addFood("f4")];
  for (const [i, step] of steps.entries()) {
    // From step `fullAt` on, the origin is full for anything that grows.
    if (i === fullAt) base.refuse = (_key, value, previous) => value.length > (previous?.length ?? 0);
    const data = engine.getSnapshot().data;
    engine.commit(step(data), data, `step ${i}`);
    await settle();
  }
  engine.stop();
}

describe("the sync engine writing through the mirror", () => {
  for (const fullAt of [Infinity, 3]) {
    const label = fullAt === Infinity ? "with room to spare" : "when the origin fills up";
    it(`leaves localStorage exactly as without it, and loses nothing, ${label}`, async () => {
      const plain = new FakeStorage();
      plain.setItem("fulbito-data", "theirs");
      await session(plain, plain, fullAt);

      const base = new FakeStorage();
      base.setItem("fulbito-data", "theirs");
      const mirror = new FakeMirror();
      const mirrored = new MirroredStorage(base, mirror, isMirroredKey);
      await session(base, mirrored, fullAt);
      await mirrored.flush();

      // localStorage: the same keys and values, byte for byte.
      assert.deepEqual(snapshotOf(base), snapshotOf(plain));
      assert.equal(base.getItem("fulbito-data"), "theirs");

      // The mirror holds every NutriApp key localStorage holds, identical...
      const local = snapshotOf(base);
      for (const [key, value] of local) {
        if (isMirroredKey(key)) assert.equal(mirror.records.get(key), value, key);
      }
      // ...and never dropped one: every key it ever stored is still there,
      // holding the last value it was given.
      for (const [key, values] of mirror.history) {
        assert.equal(mirror.records.get(key), values[values.length - 1], key);
      }
      assert.equal(mirror.records.has("fulbito-data"), false);

      const report = await mirrored.copyAndVerify();
      assert.deepEqual(report.mismatched, []);
      if (fullAt !== Infinity) {
        // The full origin made the engine drop its backup from localStorage;
        // the mirror still has it.
        assert.equal(base.getItem("nutriapp-data-backup"), null);
        assert.ok(mirror.records.has("nutriapp-data-backup"));
        assert.deepEqual(report.onlyInMirror, ["nutriapp-data-backup"]);
      }
    });
  }
});
