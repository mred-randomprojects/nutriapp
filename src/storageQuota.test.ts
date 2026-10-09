import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ORIGIN_QUOTA_BYTES,
  formatBytes,
  isNutriAppKey,
  isQuotaError,
  storageSpaceMessage,
  storageUsage,
} from "./storageQuota.js";

function memoryStorage(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries));
  return {
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

/** Node has no localStorage by default; install one for the code under test. */
function useLocalStorage(storage: Storage): void {
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
}

describe("storageUsage", () => {
  it("splits the site's bytes into this app's and everybody else's (UTF-16: chars × 2)", () => {
    useLocalStorage(
      memoryStorage({
        "nutriapp-data": "x".repeat(100),
        "nutriapp:food-form-draft:new": "{}",
        "fulbito-data": "y".repeat(1000),
        "execute:tasks": "z".repeat(10),
      }),
    );

    assert.deepEqual(storageUsage(isNutriAppKey), {
      mine: ("nutriapp-data".length + 100 + "nutriapp:food-form-draft:new".length + 2) * 2,
      others: ("fulbito-data".length + 1000 + "execute:tasks".length + 10) * 2,
    });
  });

  it("reports nothing when storage is blocked", () => {
    const blocked = memoryStorage({});
    Object.defineProperty(blocked, "length", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    useLocalStorage(blocked);

    assert.deepEqual(storageUsage(isNutriAppKey), { mine: 0, others: 0 });
  });
});

describe("isNutriAppKey", () => {
  it("matches every key NutriApp writes and nothing else", () => {
    assert.equal(isNutriAppKey("nutriapp-data"), true);
    assert.equal(isNutriAppKey("nutriapp-data-backup"), true);
    assert.equal(isNutriAppKey("nutriapp-data-corrupt-recovery"), true);
    assert.equal(isNutriAppKey("nutriapp:food-form-draft:new"), true);
    assert.equal(isNutriAppKey("fulbito-data"), false);
    assert.equal(isNutriAppKey("execute:nutriapp"), false);
  });
});

describe("isQuotaError", () => {
  it("recognises the browsers' quota errors only", () => {
    assert.equal(isQuotaError(new DOMException("full", "QuotaExceededError")), true);
    assert.equal(isQuotaError(new DOMException("full", "NS_ERROR_DOM_QUOTA_REACHED")), true);
    assert.equal(isQuotaError(new DOMException("nope", "SecurityError")), false);
    assert.equal(isQuotaError(new Error("QuotaExceededError")), false);
  });
});

describe("storageSpaceMessage", () => {
  it("says how the shared ~5 MB is split", () => {
    const message = storageSpaceMessage({ mine: 512 * 1024, others: 4 * 1024 * 1024 }, "full");
    assert.ok(message.startsWith("This browser is out of space for this site."));
    assert.ok(
      message.includes(
        "All apps on mred-randomprojects.github.io share about 5 MB: this one uses 512.0 KB, the others 4.00 MB.",
      ),
    );
  });

  it("only suggests deleting profiles when NutriApp holds at least half", () => {
    const mostlyOthers = storageSpaceMessage({ mine: 100, others: 200 }, "full");
    assert.ok(!mostlyOthers.includes("delete"));
    assert.ok(mostlyOthers.includes("Download a backup"));

    const mostlyMine = storageSpaceMessage({ mine: 200, others: 200 }, "full");
    assert.ok(mostlyMine.includes("delete old profiles"));
  });

  it("words the meter's warning as almost full", () => {
    assert.ok(
      storageSpaceMessage({ mine: 1, others: 1 }, "almost-full").startsWith(
        "This browser is almost out of space for this site.",
      ),
    );
  });
});

describe("formatBytes", () => {
  it("uses B, KB and MB", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(1536), "1.5 KB");
    assert.equal(formatBytes(ORIGIN_QUOTA_BYTES), "5.00 MB");
  });
});
