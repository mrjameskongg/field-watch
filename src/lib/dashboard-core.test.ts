import { describe, expect, it } from "vitest";
import { freshnessLabel, moneyStrip, openBatchBalance, radarAgreement, recentActivity } from "./dashboard-core";

const open = { currency: "USD", season_closed: false };
const closed = { currency: "KHR", season_closed: true };

describe("moneyStrip", () => {
  it("sums kg bought and money owed for open seasons only, by currency", () => {
    const deliveries = [
      { gross_weight_kg: 5140, price_per_kg_applied: 0.29, settlement_id: null, contracts: open },
      { gross_weight_kg: 6240, price_per_kg_applied: 0.3, settlement_id: "s1", contracts: open },
      { gross_weight_kg: 7890, price_per_kg_applied: 850, settlement_id: null, contracts: closed },
      { gross_weight_kg: 100, price_per_kg_applied: 1, settlement_id: null, contracts: null },
    ];
    const settlements = [
      { status: "paid", net_payment: 1800, contracts: open },
      { status: "draft", net_payment: 999, contracts: open },
      { status: "paid", net_payment: 5000000, contracts: closed },
    ];
    const m = moneyStrip(deliveries, settlements);
    expect(m.kgBought).toBe(11480);
    expect(m.owed.USD).toBeCloseTo(1490.6 + 100, 2);
    expect(m.owed.KHR).toBe(0);
    expect(m.paid.USD).toBe(1800);
    expect(m.paid.KHR).toBe(0);
  });
});

describe("openBatchBalance", () => {
  const pts = [
    { batch_id: "b1", stage: "received", weight_kg: 22830, moisture_pct: 22.8 },
    { batch_id: "b1", stage: "post_drying", weight_kg: 18400, moisture_pct: 14.2 },
    { batch_id: "b1", stage: "into_mill", weight_kg: 18400, moisture_pct: 14.2 },
    { batch_id: "b1", stage: "milled_output", weight_kg: 11450, moisture_pct: null },
    { batch_id: "b1", stage: "broken", weight_kg: 2050, moisture_pct: null },
    { batch_id: "b1", stage: "bran", weight_kg: 1570, moisture_pct: null },
    { batch_id: "b1", stage: "husk", weight_kg: 3100, moisture_pct: null },
    { batch_id: "b1", stage: "wastage", weight_kg: 230, moisture_pct: null },
    { batch_id: "b2", stage: "received", weight_kg: 1000, moisture_pct: 20 },
  ];
  it("totals open batches and reports zero unaccounted for the seed batch", () => {
    const b = openBatchBalance([{ id: "b1", status: "open" }, { id: "b2", status: "shipped" }], pts);
    expect(b.batches).toBe(1);
    expect(b.receivedKg).toBe(22830);
    expect(b.driedKg).toBe(18400);
    expect(b.intoMillKg).toBe(18400);
    expect(b.outputsKg).toBe(18170);
    expect(b.wastageKg).toBe(230);
    expect(b.unaccountedKg).toBe(0);
  });
  it("returns zeros with no open batches", () => {
    const b = openBatchBalance([{ id: "b2", status: "closed" }], pts);
    expect(b.batches).toBe(0);
    expect(b.receivedKg).toBe(0);
  });
});

describe("recentActivity", () => {
  it("merges four ledgers, newest first, capped at 8, deterministic tie order", () => {
    const rows = recentActivity({
      deliveries: [
        { delivery_code: "DL-1", received_date: "2026-08-25", gross_weight_kg: 5140, farmer: "Meas Bopha" },
        { delivery_code: "DL-0", received_date: "2026-08-01", gross_weight_kg: 10, farmer: "X" },
      ],
      weighPoints: [{ batch_code: "B26-0001", recorded_date: "2026-08-27", stage: "milled_output", weight_kg: 11450 }],
      settlements: [{ settlement_code: "ST-1", settled_date: "2026-08-27", net_payment: 1800, currency: "USD" }],
      dispatches: [{ dispatch_code: "DS-1", dispatched_date: "2026-08-27", product: "broken", weight_kg: 1000 }],
    }, 8);
    expect(rows.map((r) => r.kind)).toEqual(["weigh", "payment", "dispatch", "delivery", "delivery"]);
    expect(rows[0].label).toContain("B26-0001");
    expect(rows[3].to).toBe("/deliveries");
    expect(recentActivity({ deliveries: [], weighPoints: [], settlements: [], dispatches: [] }, 8)).toEqual([]);
  });
});

describe("freshnessLabel", () => {
  it("renders today / n d / dash", () => {
    expect(freshnessLabel("2026-09-08", "2026-09-08")).toBe("today");
    expect(freshnessLabel("2026-09-06", "2026-09-08")).toBe("2 d");
    expect(freshnessLabel(null, "2026-09-08")).toBe("—");
  });
});

describe("radarAgreement", () => {
  it("counts confident passes that have a logged water event within the window and match its state", () => {
    const passes = [
      { farm_id: "f1", reading_date: "2026-08-28", state: "drained", confident: true },
      { farm_id: "f1", reading_date: "2026-08-20", state: "flooded", confident: true },
      { farm_id: "f2", reading_date: "2026-08-28", state: "drained", confident: false },
      { farm_id: "f3", reading_date: "2026-08-28", state: "drained", confident: true },
    ];
    const logs = [
      { farm_id: "f1", event_date: "2026-08-26", event_type: "water", water_state: "drained" },
      { farm_id: "f1", event_date: "2026-08-19", event_type: "water", water_state: "drained" },
    ];
    const r = radarAgreement(passes, logs);
    expect(r.compared).toBe(2);
    expect(r.agreed).toBe(1);
    expect(r.pct).toBe(50);
    expect(radarAgreement([], []).pct).toBeNull();
  });
});

describe("openBatchBalance store (8 Sep 2026)", () => {
  it("sums into_storage on open batches and flags estimates", () => {
    const b = openBatchBalance(
      [{ id: "b1", status: "stored" }, { id: "b2", status: "closed" }],
      [
        { batch_id: "b1", stage: "received", weight_kg: 10000, moisture_pct: 25 },
        { batch_id: "b1", stage: "into_storage", weight_kg: 8100, moisture_pct: null, estimated: true },
        { batch_id: "b2", stage: "into_storage", weight_kg: 999, moisture_pct: null, estimated: true },
      ],
    );
    expect(b.storedKg).toBe(8100);
    expect(b.storedEstimated).toBe(true);
  });
});
