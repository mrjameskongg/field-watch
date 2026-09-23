import { describe, expect, it } from "vitest";
import {
  collapsedByDefault,
  guideProgress,
  guideSteps,
  type GuideCounts,
} from "./onboarding-core";

const zero: GuideCounts = {
  farmers: 0, farmsWithGps: 0, contracts: 0, inputAdvances: 0,
  deliveries: 0, moistureTests: 0, settlements: 0, batches: 0, shippedBatches: 0,
};

const states = (c: Partial<GuideCounts>) =>
  guideSteps({ ...zero, ...c }).map((s) => `${s.key}:${s.state}`);

describe("guideSteps", () => {
  it("empty DB: register farmers is current, everything else pending", () => {
    expect(states({})).toEqual([
      "farmers:current", "parcels:pending", "contract:pending", "inputs:pending",
      "delivery:pending", "testedPaid:pending", "batched:pending", "milled:pending",
    ]);
  });

  it("farmers but no GPS parcels: map parcels is current", () => {
    expect(states({ farmers: 2 })[0]).toBe("farmers:done");
    expect(states({ farmers: 2 })[1]).toBe("parcels:current");
  });

  it("farmers + parcels: contract is current", () => {
    expect(states({ farmers: 2, farmsWithGps: 1 })[2]).toBe("contract:current");
  });

  it("contract exists, no advances: inputs is skipped, delivery is current", () => {
    const s = states({ farmers: 2, farmsWithGps: 1, contracts: 1 });
    expect(s[3]).toBe("inputs:skipped");
    expect(s[4]).toBe("delivery:current");
  });

  it("no contract yet: inputs is plain pending, not skipped", () => {
    expect(states({ farmers: 2, farmsWithGps: 1 })[3]).toBe("inputs:pending");
  });

  it("advances recorded: inputs is done", () => {
    expect(states({ farmers: 2, farmsWithGps: 1, contracts: 1, inputAdvances: 1 })[3]).toBe("inputs:done");
  });

  it("testedPaid needs BOTH a moisture test and a settlement", () => {
    const base = { farmers: 2, farmsWithGps: 1, contracts: 1, deliveries: 1 };
    expect(states({ ...base, moistureTests: 1 })[5]).toBe("testedPaid:current");
    expect(states({ ...base, settlements: 1 })[5]).toBe("testedPaid:current");
    expect(states({ ...base, moistureTests: 1, settlements: 1 })[5]).toBe("testedPaid:done");
  });

  it("milled needs a shipped/closed batch, not just any batch", () => {
    const base = {
      farmers: 2, farmsWithGps: 1, contracts: 1, inputAdvances: 1,
      deliveries: 1, moistureTests: 1, settlements: 1, batches: 1,
    };
    expect(states(base)[7]).toBe("milled:current");
    expect(states({ ...base, shippedBatches: 1 })[7]).toBe("milled:done");
  });

  it("exactly one current across arbitrary count combinations", () => {
    const values = [0, 1];
    for (const farmers of values) for (const farmsWithGps of values)
    for (const contracts of values) for (const inputAdvances of values)
    for (const deliveries of values) for (const moistureTests of values)
    for (const settlements of values) for (const batches of values)
    for (const shippedBatches of values) {
      const steps = guideSteps({
        farmers, farmsWithGps, contracts, inputAdvances,
        deliveries, moistureTests, settlements, batches, shippedBatches,
      });
      const current = steps.filter((s) => s.state === "current").length;
      const allDone = steps.every((s) => s.state === "done" || s.state === "skipped");
      expect(current, JSON.stringify(steps)).toBe(allDone ? 0 : 1);
    }
  });

  it("fully running operation: no current step at all", () => {
    const steps = guideSteps({
      farmers: 5, farmsWithGps: 5, contracts: 3, inputAdvances: 2,
      deliveries: 9, moistureTests: 9, settlements: 4, batches: 2, shippedBatches: 2,
    });
    expect(steps.every((s) => s.state === "done" || s.state === "skipped")).toBe(true);
  });
});

describe("guideProgress", () => {
  it("counts done and skipped as progress", () => {
    const steps = guideSteps({ ...zero, farmers: 1, farmsWithGps: 1, contracts: 1 });
    // farmers done, parcels done, contract done, inputs skipped => 4 of 8
    expect(guideProgress(steps)).toEqual({ done: 4, total: 8 });
  });
});

describe("collapsedByDefault", () => {
  it("expanded until the first settlement, collapsed after", () => {
    expect(collapsedByDefault(zero)).toBe(false);
    expect(collapsedByDefault({ ...zero, settlements: 1 })).toBe(true);
  });
});
