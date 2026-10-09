import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeBmr, computeExpectedWeight, computeTdee } from "./calculator.js";
import type { WeightLossPlan } from "./types.js";

function assertClose(actual: number | null, expected: number): void {
  assert.ok(actual != null, "expected a number, got null");
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);
}

describe("computeBmr (Mifflin-St Jeor)", () => {
  it("adds 5 kcal for men and subtracts 161 for women", () => {
    // 10 × 80 + 6.25 × 180 − 5 × 30 = 1775
    assert.equal(computeBmr("male", 80, 180, 30), 1780);
    assert.equal(computeBmr("female", 80, 180, 30), 1614);
  });
});

describe("computeTdee", () => {
  it("multiplies the BMR by the activity factor", () => {
    assertClose(computeTdee("male", 80, 180, 30, "sedentary"), 1780 * 1.2);
    assertClose(computeTdee("male", 80, 180, 30, "moderately_active"), 1780 * 1.55);
    // 10 × 60 + 6.25 × 165 − 5 × 25 − 161 = 1345.25
    assertClose(computeTdee("female", 60, 165, 25, "very_active"), 1345.25 * 1.9);
  });
});

describe("computeExpectedWeight", () => {
  const plan: WeightLossPlan = {
    startDate: "2026-06-01",
    startWeightKg: 90,
    targetWeightKg: 80,
    weeklyLossRateKg: 0.5,
  };

  it("is the start weight on the start date", () => {
    assertClose(computeExpectedWeight(plan, "2026-06-01"), 90);
  });

  it("falls linearly at the weekly rate", () => {
    assertClose(computeExpectedWeight(plan, "2026-06-15"), 89);
    assertClose(computeExpectedWeight(plan, "2026-06-04"), 90 - (3 / 7) * 0.5);
  });

  it("is null before the plan starts", () => {
    assert.equal(computeExpectedWeight(plan, "2026-05-31"), null);
  });

  it("stays at the target once the plan reaches it", () => {
    // The doc comment says "null" here, but the code clamps to the target.
    // This pins the code.
    assertClose(computeExpectedWeight(plan, "2027-06-01"), 80);
  });
});
