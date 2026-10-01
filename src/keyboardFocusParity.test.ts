import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WEBKIT_SKIPPED_CONTROL_SELECTOR,
  giveExplicitTabIndex,
  needsExplicitTabIndex,
  normalizeKeyboardFocusOrder,
  type FocusParityElement,
} from "./keyboardFocusParity.js";

/**
 * A stand-in for the one `Element` method that decides the answer, so these run
 * without a DOM like the rest of the suite. `selectors` is what this element
 * would match.
 */
function element(
  selectors: ReadonlyArray<string>,
  attributes: Record<string, string> = {},
): FocusParityElement & { attributes: Record<string, string> } {
  const own = { ...attributes };
  return {
    attributes: own,
    matches: (selector) =>
      selector
        .split(",")
        .some((part) => selectors.includes(part.trim())),
    hasAttribute: (name) => name in own,
    setAttribute: (name, value) => {
      own[name] = value;
    },
  };
}

function root(controls: ReadonlyArray<FocusParityElement>) {
  return { querySelectorAll: () => controls };
}

describe("the controls WebKit leaves out of the keyboard focus order", () => {
  it("covers the elements measured as unreachable in WebKit", () => {
    for (const selector of [
      "button",
      "a[href]",
      'input[type="checkbox"]',
      'input[type="radio"]',
      'input[type="submit"]',
      'input[type="reset"]',
      'input[type="button"]',
      'input[type="file"]',
      'input[type="color"]',
      'input[type="range"]',
      'input[type="image"]',
    ]) {
      assert.ok(
        WEBKIT_SKIPPED_CONTROL_SELECTOR.includes(selector),
        `${selector} should be covered`,
      );
    }
  });

  it("leaves out the fields both engines already agree on", () => {
    // Adding these would be churn: WebKit tabs to them already.
    for (const type of ["text", "search", "email", "password", "number", "date"]) {
      assert.ok(
        !WEBKIT_SKIPPED_CONTROL_SELECTOR.includes(`input[type="${type}"]`),
        `input[type="${type}"] should not be touched`,
      );
    }
  });
});

describe("needsExplicitTabIndex", () => {
  it("claims a button with no tabindex", () => {
    assert.equal(needsExplicitTabIndex(element(["button"])), true);
  });

  it("leaves a tabindex someone already chose alone", () => {
    // Radix's roving tab stops and the log rows' own tabIndex both land here.
    assert.equal(
      needsExplicitTabIndex(element(["button"], { tabindex: "-1" })),
      false,
    );
    assert.equal(
      needsExplicitTabIndex(element(["button"], { tabindex: "0" })),
      false,
    );
  });

  it("ignores elements the engines agree on", () => {
    assert.equal(needsExplicitTabIndex(element(['input[type="text"]'])), false);
    assert.equal(needsExplicitTabIndex(element(["div"])), false);
  });
});

describe("giveExplicitTabIndex", () => {
  it("writes tabindex=0 and says it did", () => {
    const button = element(["button"]);
    assert.equal(giveExplicitTabIndex(button), true);
    assert.equal(button.attributes.tabindex, "0");
  });

  it("does not touch an element that already has one", () => {
    const button = element(["button"], { tabindex: "-1" });
    assert.equal(giveExplicitTabIndex(button), false);
    assert.equal(button.attributes.tabindex, "-1");
  });
});

describe("normalizeKeyboardFocusOrder", () => {
  it("gives every bare control a tab stop and counts them", () => {
    const bare = [element(["button"]), element(["a[href]"])];
    const spokenFor = element(["button"], { tabindex: "-1" });
    assert.equal(normalizeKeyboardFocusOrder(root([...bare, spokenFor])), 2);
    for (const control of bare) {
      assert.equal(control.attributes.tabindex, "0");
    }
    assert.equal(spokenFor.attributes.tabindex, "-1");
  });

  it("is idempotent, so a re-run over a mounted tree changes nothing", () => {
    const controls = [element(["button"]), element(["button"])];
    assert.equal(normalizeKeyboardFocusOrder(root(controls)), 2);
    assert.equal(normalizeKeyboardFocusOrder(root(controls)), 0);
  });
});
