import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchDeployedCommit, isNewerBuild, reloadNow } from "./appVersion.js";

describe("isNewerBuild", () => {
  it("is true only for a different deployed commit, and never in a dev build", () => {
    assert.equal(isNewerBuild("abc1234", "abc1234"), false);
    assert.equal(isNewerBuild("abc1234", "def5678"), true);
    assert.equal(isNewerBuild("dev", "def5678"), false, "a local build never reloads itself");
    assert.equal(isNewerBuild("abc1234", null), false, "no answer is no update");
  });
});

describe("fetchDeployedCommit", () => {
  it("asks for version.json past every cache and reads its commit", async () => {
    const calls: Array<{ url: string; cache: string | undefined }> = [];
    const commit = await fetchDeployedCommit("/nutriapp/", async (url, init) => {
      calls.push({ url: String(url), cache: init?.cache });
      return new Response(JSON.stringify({ commit: "def5678", deployedAt: "2026-10-21T00:00:00Z" }));
    });
    assert.equal(commit, "def5678");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^\/nutriapp\/version\.json\?t=\d+$/);
    assert.equal(calls[0].cache, "no-store");
  });

  it("answers null when offline, on a 404 or on anything but a commit", async () => {
    assert.equal(await fetchDeployedCommit("/", async () => { throw new TypeError("offline"); }), null);
    assert.equal(await fetchDeployedCommit("/", async () => new Response("nope", { status: 404 })), null);
    assert.equal(await fetchDeployedCommit("/", async () => new Response("{\"commit\":7}")), null);
    assert.equal(await fetchDeployedCommit("/", async () => new Response("<html>")), null);
  });
});

describe("reloadNow", () => {
  const calm = {
    returning: true,
    unsavedForm: false,
    dialogOpen: false,
    typing: false,
    localCopyStored: true,
  };

  it("reloads when the person just came back and nothing is being edited", () => {
    assert.equal(reloadNow(calm), true);
  });

  it("waits behind the pill otherwise", () => {
    assert.equal(reloadNow({ ...calm, returning: false }), false, "not while they are using it");
    assert.equal(reloadNow({ ...calm, unsavedForm: true }), false);
    assert.equal(reloadNow({ ...calm, dialogOpen: true }), false);
    assert.equal(reloadNow({ ...calm, typing: true }), false);
    assert.equal(reloadNow({ ...calm, localCopyStored: false }), false, "edits only in memory would be lost");
  });
});
