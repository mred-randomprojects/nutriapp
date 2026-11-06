import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRememberedUid, rememberUid, REMEMBERED_UID_KEY, uidToShow } from "./rememberedUid.js";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

describe("remembered uid", () => {
  it("is empty on a fresh browser", () => {
    assert.equal(readRememberedUid(new MemoryStorage()), null);
  });

  it("keeps the account Auth confirmed, and forgets it on sign-out", () => {
    const storage = new MemoryStorage();
    rememberUid("abc", storage);
    assert.equal(readRememberedUid(storage), "abc");
    rememberUid(null, storage);
    assert.equal(readRememberedUid(storage), null);
    assert.equal(storage.getItem(REMEMBERED_UID_KEY), null);
  });

  it("follows a switch to another account", () => {
    const storage = new MemoryStorage();
    rememberUid("abc", storage);
    rememberUid("def", storage);
    assert.equal(readRememberedUid(storage), "def");
  });
});

describe("uidToShow", () => {
  it("draws the remembered account while Auth is checking", () => {
    assert.equal(uidToShow(true, null, "abc"), "abc");
  });
  it("waits (spinner) while checking with nothing remembered", () => {
    assert.equal(uidToShow(true, null, null), null);
  });
  it("goes with Auth's answer once it arrives", () => {
    assert.equal(uidToShow(false, "def", "abc"), "def");
    assert.equal(uidToShow(false, null, "abc"), null);
  });
});
