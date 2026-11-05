import { test } from "node:test";
import assert from "node:assert/strict";
import { nextEntryView, parseEntryView } from "./entryView.js";

test("parseEntryView keeps the three views and falls back to comfortable", () => {
  assert.equal(parseEntryView("compact"), "compact");
  assert.equal(parseEntryView("gallery"), "gallery");
  assert.equal(parseEntryView("comfortable"), "comfortable");
  assert.equal(parseEntryView(null), "comfortable");
  assert.equal(parseEntryView("grid"), "comfortable");
});

test("nextEntryView cycles compact → comfortable → gallery → compact", () => {
  assert.equal(nextEntryView("compact"), "comfortable");
  assert.equal(nextEntryView("comfortable"), "gallery");
  assert.equal(nextEntryView("gallery"), "compact");
});
