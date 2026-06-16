import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isFocusFirstSearchOptionKey } from "./searchOptionKeyboard.js";

describe("search option keyboard helpers", () => {
  it("treats plain arrow down as focus-first-option", () => {
    assert.equal(isFocusFirstSearchOptionKey({ key: "ArrowDown" }), true);
  });

  it("ignores arrow down with modifiers", () => {
    assert.equal(
      isFocusFirstSearchOptionKey({ key: "ArrowDown", shiftKey: true }),
      false,
    );
    assert.equal(
      isFocusFirstSearchOptionKey({ key: "ArrowDown", altKey: true }),
      false,
    );
    assert.equal(
      isFocusFirstSearchOptionKey({ key: "ArrowDown", metaKey: true }),
      false,
    );
    assert.equal(
      isFocusFirstSearchOptionKey({ key: "ArrowDown", ctrlKey: true }),
      false,
    );
  });

  it("ignores other keys", () => {
    assert.equal(isFocusFirstSearchOptionKey({ key: "Tab" }), false);
    assert.equal(isFocusFirstSearchOptionKey({ key: "Enter" }), false);
  });
});
