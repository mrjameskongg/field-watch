import { describe, expect, it } from "vitest";
import { CHAIN_STEPS, chainProgress, chainSteps, type ChainInput } from "./chain-core";

const base: ChainInput = {
  farmerRegisteredDate: "2026-05-28",
  farmerName: "Sok Dara",
  contractSignedDate: null,
  contractCode: "CT-1",
  expectedKg: 12500,
  advances: [],
  deliveries: [],
  qcTests: [],
  settlements: [],
  batches: [],
};

const delivery = (over: Partial<ChainInput["deliveries"][number]> = {}) => ({
  id: "d1",
  code: "DL-1",
  received_date: "2026-11-18",
  gross_weight_kg: 11840,
  moisture_pct: 26,
  settlement_id: null,
  batch_id: null,
  ...over,
});

describe("chainSteps", () => {
  it("always returns the eight steps in process order", () => {
    const steps = chainSteps(base);
    expect(steps).toHaveLength(CHAIN_STEPS.length);
    expect(steps.map((s) => s.key)).toEqual([
      "biodata",
      "contract",
      "inputs",
      "delivery",
      "tested",
      "paid",
      "dried",
      "milled",
    ]);
  });

  it("marks the farmer step done from the registration date", () => {
    const [biodata] = chainSteps(base);
    expect(biodata.state).toBe("done");
    expect(biodata.date).toBe("2026-05-28");
    expect(biodata.detail).toContain("Sok Dara");
  });

  it("contract is unfinished until signed, done after", () => {
    // Unsigned it is the first unfinished step, so it carries "current".
    expect(chainSteps(base)[1].state).toBe("current");
    const signed = chainSteps({ ...base, contractSignedDate: "2026-06-02" });
    expect(signed[1].state).toBe("done");
    expect(signed[1].date).toBe("2026-06-02");
  });

  it("inputs step is skipped, not pending, when a contract has no advances", () => {
    // Not every farmer takes an advance — an empty step must not read as
    // work outstanding.
    const signed = chainSteps({ ...base, contractSignedDate: "2026-06-02" });
    expect(signed[2].state).toBe("skipped");
  });

  it("sums advances when present", () => {
    const s = chainSteps({
      ...base,
      contractSignedDate: "2026-06-02",
      advances: [
        { date_issued: "2026-06-10", total_cost: 200 },
        { date_issued: "2026-06-12", total_cost: 100 },
      ],
    });
    expect(s[2].state).toBe("done");
    expect(s[2].date).toBe("2026-06-10");
    expect(s[2].detail).toContain("300");
  });

  it("delivery step counts loads and kilos against the contract", () => {
    const s = chainSteps({ ...base, contractSignedDate: "2026-06-02", deliveries: [delivery()] });
    expect(s[3].state).toBe("done");
    expect(s[3].date).toBe("2026-11-18");
    expect(s[3].detail).toContain("11,840 kg");
    expect(s[3].detail).toContain("95%");
  });

  it("tested step needs a moisture test for every delivery", () => {
    const withDelivery = { ...base, contractSignedDate: "2026-06-02", deliveries: [delivery()] };
    expect(chainSteps(withDelivery)[4].state).toBe("current");
    const tested = chainSteps({
      ...withDelivery,
      qcTests: [{ delivery_id: "d1", test_type: "moisture", tested_date: "2026-11-18" }],
    });
    expect(tested[4].state).toBe("done");
    expect(tested[4].date).toBe("2026-11-18");
  });

  it("a partially tested set of deliveries is still current", () => {
    const s = chainSteps({
      ...base,
      contractSignedDate: "2026-06-02",
      deliveries: [delivery(), delivery({ id: "d2", code: "DL-2" })],
      qcTests: [{ delivery_id: "d1", test_type: "moisture", tested_date: "2026-11-18" }],
    });
    expect(s[4].state).toBe("current");
    expect(s[4].detail).toContain("1 of 2");
  });

  it("paid step reports the settled net", () => {
    const s = chainSteps({
      ...base,
      contractSignedDate: "2026-06-02",
      deliveries: [delivery({ settlement_id: "s1" })],
      qcTests: [{ delivery_id: "d1", test_type: "moisture", tested_date: "2026-11-18" }],
      settlements: [{ settled_date: "2026-11-18", net_payment: 3252, status: "paid" }],
    });
    expect(s[5].state).toBe("done");
    expect(s[5].detail).toContain("3,252");
  });

  it("dried step waits for a batch, then reports drying", () => {
    const withBatch = chainSteps({
      ...base,
      contractSignedDate: "2026-06-02",
      deliveries: [delivery({ batch_id: "b1" })],
      batches: [{ id: "b1", batch_code: "B26-1", status: "drying", dryingLossPct: null, dryingLossEstimated: false }],
    });
    expect(withBatch[6].state).toBe("done");
    expect(withBatch[6].detail).toContain("B26-1");

    const dried = chainSteps({
      ...base,
      contractSignedDate: "2026-06-02",
      deliveries: [delivery({ batch_id: "b1" })],
      batches: [{ id: "b1", batch_code: "B26-1", status: "stored", dryingLossPct: 20, dryingLossEstimated: false }],
    });
    expect(dried[6].detail).toContain("20%");
  });

  it("milled step follows batch status", () => {
    const open = chainSteps({
      ...base,
      deliveries: [delivery({ batch_id: "b1" })],
      batches: [{ id: "b1", batch_code: "B26-1", status: "drying", dryingLossPct: null, dryingLossEstimated: false }],
    });
    expect(open[7].state).toBe("pending");
    const shipped = chainSteps({
      ...base,
      deliveries: [delivery({ batch_id: "b1" })],
      batches: [{ id: "b1", batch_code: "B26-1", status: "shipped", dryingLossPct: null, dryingLossEstimated: false }],
    });
    expect(shipped[7].state).toBe("done");
  });

  it("only the first unfinished step is current — later ones stay pending", () => {
    const s = chainSteps(base);
    expect(s.filter((x) => x.state === "current")).toHaveLength(1);
    expect(s[1].state).toBe("current");
    expect(s[3].state).toBe("pending");
  });
});

describe("chainProgress", () => {
  it("counts done and skipped steps as settled", () => {
    expect(chainProgress(chainSteps(base))).toEqual({ done: 1, total: 8 });
    const s = chainSteps({ ...base, contractSignedDate: "2026-06-02" });
    // biodata done + inputs skipped
    expect(chainProgress(s).done).toBe(3);
  });
});

describe("chainSteps currency", () => {
  it("prints advance and payment money in the contract's currency", () => {
    const steps = chainSteps({
      ...base,
      currency: "KHR",
      contractSignedDate: "2026-06-02",
      advances: [{ date_issued: "2026-06-10", total_cost: 4100 }],
    });
    const inputs = steps.find((s) => s.key === "inputs");
    expect(inputs?.detail).toContain("4,100 ៛");
    expect(inputs?.detail).not.toContain("$");
  });
});

describe("contract step and the contract's own status", () => {
  it("an active contract with no signed date still counts as signed", () => {
    // The signed date is an optional field on the form; a contract the office
    // marked active must not read "Next: sign the contract".
    const steps = chainSteps({ ...base, contractSignedDate: null, contractStatus: "active" });
    expect(steps[1].state).toBe("done");
    expect(steps[1].date).toBeNull();
  });

  it("a completed contract counts as signed too", () => {
    expect(chainSteps({ ...base, contractStatus: "completed" })[1].state).toBe("done");
  });

  it("a cancelled contract without a signed date stays unfinished", () => {
    expect(chainSteps({ ...base, contractStatus: "cancelled" })[1].state).toBe("current");
  });

  it("step 5 is called Moisture tested", () => {
    expect(CHAIN_STEPS[4].title).toBe("Moisture tested");
  });
});

describe("estimated drying loss (8 Sep 2026)", () => {
  it("marks an estimated drying loss with ≈", () => {
    const dried = chainSteps({
      ...base,
      deliveries: [delivery({ batch_id: "b1" })],
      batches: [{ id: "b1", batch_code: "B26-1", status: "stored", dryingLossPct: 19, dryingLossEstimated: true }],
    });
    expect(dried[6].detail).toContain("≈ 19%");
  });
});

describe("chainSteps with money hidden from the viewer's role", () => {
  const settled = { ...base, contractSignedDate: "2026-06-02", deliveries: [delivery({ settlement_id: "s1" })] };

  it("says advances are office only instead of claiming none were taken", () => {
    const inputs = chainSteps({ ...settled, hidden: { advances: true } }).find((s) => s.key === "inputs")!;
    expect(inputs.detail).toBe("Office only");
    expect(inputs.state).toBe("skipped");
    expect(inputs.date).toBeNull();
  });

  it("marks the farmer paid from the loads' settled flag when settlements are hidden", () => {
    const paid = chainSteps({ ...settled, hidden: { settlements: true } }).find((s) => s.key === "paid")!;
    expect(paid.state).toBe("done");
    expect(paid.detail).toBe("1 of 1 load(s) settled · amounts office only");
    expect(paid.date).toBeNull();
  });

  it("still says not settled when no load is settled", () => {
    const open = { ...settled, deliveries: [delivery()] };
    const paid = chainSteps({ ...open, hidden: { settlements: true } }).find((s) => s.key === "paid")!;
    expect(paid.state).not.toBe("done");
    expect(paid.detail).toBe("Not settled yet");
  });
});
