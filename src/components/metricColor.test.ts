import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { budgetBarTone, KCAL_OVER_TOLERANCE, metricNumberTone } from "./metricColor.js";

describe("kcal (limit with 20% tolerance)", () => {
  const tone = (actual: number) => [
    metricNumberTone(actual, 2500, "limit", KCAL_OVER_TOLERANCE),
    budgetBarTone(actual, 2500, "limit", KCAL_OVER_TOLERANCE),
  ];
  it("is green well under the budget", () => assert.deepEqual(tone(2000), ["neutral", "good"]));
  it("warns near the budget", () => assert.deepEqual(tone(2400), ["neutral", "warn"]));
  it("is yellow between 100% and 120%", () => {
    assert.deepEqual(tone(2558), ["warn", "warn"]);
    assert.deepEqual(tone(3000), ["warn", "warn"]);
  });
  it("is red past 120%", () => assert.deepEqual(tone(3001), ["bad", "bad"]));
});

describe("limit without tolerance (sat fat)", () => {
  it("is red as soon as it passes the budget", () => {
    assert.equal(metricNumberTone(29, 28, "limit"), "bad");
    assert.equal(budgetBarTone(29, 28, "limit"), "bad");
  });
});

describe("minimum and target", () => {
  it("protein short of budget is red, over is green", () => {
    assert.equal(metricNumberTone(100, 175, "minimum"), "bad");
    assert.equal(metricNumberTone(176, 175, "minimum"), "good");
  });
  it("fiber short of budget is yellow, over is green", () => {
    assert.equal(metricNumberTone(20, 30, "target"), "warn");
    assert.equal(budgetBarTone(35, 30, "target"), "good");
  });
});
