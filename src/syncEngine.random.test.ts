import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { simulate, type SimOptions } from "./syncSimulation.js";

async function runSeeds(options: Omit<SimOptions, "seed">, seeds: number, first = 1) {
  const failures: string[] = [];
  for (let seed = first; seed < first + seeds; seed++) {
    const problems = await simulate({ ...options, seed });
    if (problems.length > 0) failures.push(`seed ${seed}: ${problems.slice(0, 6).join("\n  ")}`);
  }
  assert.deepEqual(failures, [], failures.join("\n\n"));
}

describe("random histories (offline, relaunches, deaths mid-save, full quota): every owner's latest change wins, everywhere", () => {
  it("two devices, one tab each", async () => {
    await runSeeds({ browsers: 2, tabsPerBrowser: 1, steps: 160 }, 150);
  });

  it("three devices, one tab each", async () => {
    await runSeeds({ browsers: 3, tabsPerBrowser: 1, steps: 160 }, 80, 1000);
  });

  it("two devices with two tabs each (storage events, a shared quota)", async () => {
    await runSeeds({ browsers: 2, tabsPerBrowser: 2, steps: 160 }, 80, 3000);
  });

  it("one browser with three tabs", async () => {
    await runSeeds({ browsers: 1, tabsPerBrowser: 3, steps: 160 }, 50, 5000);
  });
});
