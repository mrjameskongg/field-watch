import { describe, expect, it } from "vitest";
import { millNext, stockSnapshot, type StockBatchLite, type StockDeliveryLite, type StockWeighLite } from "./stock-core";

const d = (id: string, kg: number, batchId: string | null): StockDeliveryLite => ({
  id,
  gross_weight_kg: kg,
  batch_id: batchId,
});

const b = (id: string, code: string, status = "open"): StockBatchLite => ({
  id,
  batch_code: code,
  status,
  crop_type: "rice",
  variety: null,
  created_date: "2026-01-01",
});

const w = (batchId: string, stage: string, kg: number): StockWeighLite => ({
  batch_id: batchId,
  stage,
  weight_kg: kg,
  moisture_pct: null,
});

describe("stockSnapshot", () => {
  it("returns zeros on empty input", () => {
    const s = stockSnapshot([], [], []);
    expect(s.intakeWetKg).toBe(0);
    expect(s.intakeDeliveryCount).toBe(0);
    expect(s.driedAwaitingMillKg).toBe(0);
    expect(s.totalOutputKg).toBe(0);
    expect(s.perBatch).toEqual([]);
  });

  it("counts only unassigned deliveries as intake stock", () => {
    const s = stockSnapshot([d("d1", 1000, null), d("d2", 2500.5, null), d("d3", 999, "b1")], [b("b1", "B1")], []);
    expect(s.intakeWetKg).toBe(3500.5);
    expect(s.intakeDeliveryCount).toBe(2);
  });

  it("computes dried-awaiting-mill per batch, floored at zero", () => {
    const points = [
      w("b1", "post_drying", 18400),
      w("b1", "into_mill", 18400),
      w("b2", "post_drying", 5000),
      w("b2", "into_mill", 2000),
      // b3: milled more than the drying record shows — clamp, don't go negative
      w("b3", "post_drying", 1000),
      w("b3", "into_mill", 1500),
    ];
    const s = stockSnapshot([], [b("b1", "B1"), b("b2", "B2"), b("b3", "B3")], points);
    expect(s.perBatch[0].driedAwaitingMillKg).toBe(0);
    expect(s.perBatch[1].driedAwaitingMillKg).toBe(3000);
    expect(s.perBatch[2].driedAwaitingMillKg).toBe(0);
    expect(s.driedAwaitingMillKg).toBe(3000);
  });

  it("totals the four outputs across batches and excludes wastage from stock", () => {
    const points = [
      w("b1", "milled_output", 11450),
      w("b1", "broken", 2050),
      w("b1", "bran", 1570),
      w("b1", "husk", 3100),
      w("b1", "wastage", 230),
      w("b2", "milled_output", 500),
    ];
    const s = stockSnapshot([], [b("b1", "B1"), b("b2", "B2")], points);
    expect(s.outputs.headRiceKg).toBe(11950);
    expect(s.outputs.brokenKg).toBe(2050);
    expect(s.outputs.branKg).toBe(1570);
    expect(s.outputs.huskKg).toBe(3100);
    expect(s.totalOutputKg).toBe(18670);
    expect(s.wastageKg).toBe(230);
  });

  it("sums repeated weigh points at the same stage (many loads, one dryer)", () => {
    const points = [w("b1", "received", 10000), w("b1", "received", 12830)];
    const s = stockSnapshot([], [b("b1", "B1")], points);
    expect(s.perBatch[0].receivedKg).toBe(22830);
  });

  it("keeps per-batch rows for batches with no weigh points yet", () => {
    const s = stockSnapshot([], [b("b1", "B26-0002", "open")], []);
    expect(s.perBatch).toHaveLength(1);
    expect(s.perBatch[0].receivedKg).toBe(0);
    expect(s.perBatch[0].outputsKg).toBe(0);
  });
});

describe("stockSnapshot with dispatches", () => {
  it("subtracts dispatched kg per product and totals on hand", () => {
    const points = [
      w("b1", "milled_output", 11450),
      w("b1", "bran", 1570),
    ];
    const s = stockSnapshot([], [b("b1", "B1")], points, [
      { product: "milled_output", weight_kg: 1000, price_per_kg: 0.9 },
      { product: "bran", weight_kg: 70, price_per_kg: null },
    ]);
    expect(s.dispatched.headRiceKg).toBe(1000);
    expect(s.onHand.headRiceKg).toBe(10450);
    expect(s.onHand.branKg).toBe(1500);
    expect(s.totalDispatchedKg).toBe(1070);
    expect(s.totalOnHandKg).toBe(11950);
  });

  it("goes negative when oversold — surfaced, never clamped", () => {
    const s = stockSnapshot([], [b("b1", "B1")], [w("b1", "husk", 100)], [
      { product: "husk", weight_kg: 150, price_per_kg: null },
    ]);
    expect(s.onHand.huskKg).toBe(-50);
  });
});

const bv = (id: string, code: string, variety: string | null, created_date: string, status = "stored"): StockBatchLite => ({
  id, batch_code: code, status, crop_type: "rice", variety, created_date,
});
const we = (batchId: string, stage: string, kg: number, estimated: boolean, recorded_date: string): StockWeighLite => ({
  batch_id: batchId, stage, weight_kg: kg, moisture_pct: null, estimated, recorded_date,
});

describe("in store and mill next (mill manager, 8 Sep 2026)", () => {
  it("in store prefers into_storage over post_drying and carries the estimate", () => {
    const s = stockSnapshot([], [bv("b1", "B1", "Sen Kra Ob", "2026-11-01")], [
      we("b1", "post_drying", 12000, false, "2026-11-02"),
      we("b1", "into_storage", 12150, true, "2026-11-03"),
      we("b1", "into_mill", 4000, false, "2026-11-20"),
    ]);
    expect(s.perBatch[0].storedKg).toBe(12150);
    expect(s.perBatch[0].driedAwaitingMillKg).toBe(8150);
    expect(s.perBatch[0].inStoreEstimated).toBe(true);
    expect(s.perBatch[0].inStoreSince).toBe("2026-11-03");
    expect(s.driedAwaitingMillKg).toBe(8150);
    expect(s.driedAwaitingEstimated).toBe(true);
  });
  it("falls back to post_drying when nothing was put in store", () => {
    const s = stockSnapshot([], [bv("b1", "B1", null, "2026-11-01")], [we("b1", "post_drying", 900, false, "2026-11-02")]);
    expect(s.perBatch[0].storedKg).toBeNull();
    expect(s.perBatch[0].driedAwaitingMillKg).toBe(900);
    expect(s.perBatch[0].inStoreEstimated).toBe(false);
    expect(s.driedAwaitingEstimated).toBe(false);
  });
  it("millNext groups by variety, oldest in store first, with days in store", () => {
    const s = stockSnapshot([], [
      bv("b1", "B1", "Sen Kra Ob", "2026-11-01"),
      bv("b2", "B2", "Sen Kra Ob", "2026-11-05"),
      bv("b3", "B3", "Phka Rumduol", "2026-11-03"),
      bv("b4", "B4", "Sen Kra Ob", "2026-11-06"),
    ], [
      we("b1", "into_storage", 5000, true, "2026-11-02"),
      we("b2", "into_storage", 6000, true, "2026-11-06"),
      we("b3", "post_drying", 7000, false, "2026-11-04"),
      we("b4", "into_storage", 800, true, "2026-11-07"),
      we("b4", "into_mill", 800, false, "2026-11-08"),
    ]);
    const groups = millNext(s.perBatch, "2026-11-12");
    expect(groups.map((g) => g.variety)).toEqual(["Phka Rumduol", "Sen Kra Ob"]);
    const sko = groups[1];
    expect(sko.rows.map((r) => r.batchCode)).toEqual(["B1", "B2"]);
    expect(sko.rows[0].daysInStore).toBe(10);
    expect(groups[0].rows[0].daysInStore).toBe(9);
  });
  it("millNext puts batches with no variety under 'Unknown variety' and skips empty stores", () => {
    const s = stockSnapshot([], [bv("b1", "B1", null, "2026-11-01")], [we("b1", "into_storage", 100, true, "2026-11-02")]);
    expect(millNext(s.perBatch, "2026-11-03")[0].variety).toBe("Unknown variety");
    expect(millNext([], "2026-11-03")).toEqual([]);
  });
});
