import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KCAL_OVER_TOLERANCE, metricTone } from "./metricColor.js";

describe("kcal (limit with 20% tolerance)", () => {
  const tone = (actual: number) => metricTone(actual, 2500, "limit", KCAL_OVER_TOLERANCE);
  it("is green well under the budget", () => assert.equal(tone(2000), "good"));
  it("warns near the budget", () => assert.equal(tone(2250), "warn"));
  it("is yellow between 100% and 120%", () => {
    assert.equal(tone(2558), "warn");
    assert.equal(tone(3000), "warn");
  });
  it("is red past 120%", () => assert.equal(tone(3001), "bad"));
});

describe("sat fat (limit without tolerance)", () => {
  it("is green under 90%", () => assert.equal(metricTone(14, 16, "limit"), "good"));
  it("is yellow from 90% to the budget", () => assert.equal(metricTone(16, 16, "limit"), "warn"));
  it("is red as soon as it passes the budget", () => assert.equal(metricTone(29, 28, "limit"), "bad"));
});

describe("protein (minimum)", () => {
  it("is red well short of the budget", () => assert.equal(metricTone(80, 102, "minimum"), "bad"));
  it("is yellow just short of the budget", () => assert.equal(metricTone(95, 102, "minimum"), "warn"));
  it("is green from the budget up", () => {
    assert.equal(metricTone(175, 175, "minimum"), "good");
    assert.equal(metricTone(180, 175, "minimum"), "good");
  });
});

describe("fiber (target)", () => {
  it("is yellow short of the budget, never red", () => assert.equal(metricTone(2, 30, "target"), "warn"));
  it("is green from the budget up", () => assert.equal(metricTone(30, 30, "target"), "good"));
});
