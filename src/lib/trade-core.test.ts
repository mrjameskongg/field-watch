import { describe, expect, it } from "vitest";
import {
  deliveryValue, fmtUsd, genCode, latestPriceFor, moistureFlagged,
  performanceRatio, round2, settlementMath, untestedDeliveryIds, type PriceRow,
} from "./trade-core";

const P = (date: string, price: number, crop = "rice"): PriceRow =>
  ({ price_date: date, crop_type: crop, price_per_kg: price });

describe("moistureFlagged", () => {
  it("flags strictly above 24", () => {
    expect(moistureFlagged(24.1)).toBe(true);
    expect(moistureFlagged(30)).toBe(true);
  });
  it("does not flag 24.0 exactly, below, or missing", () => {
    expect(moistureFlagged(24)).toBe(false);
    expect(moistureFlagged(18)).toBe(false);
    expect(moistureFlagged(null)).toBe(false);
    expect(moistureFlagged(undefined)).toBe(false);
  });
});

describe("latestPriceFor", () => {
  const prices = [P("2026-08-01", 0.28), P("2026-08-10", 0.3), P("2026-08-10", 9, "cassava"), P("2026-08-20", 0.31)];
  it("picks newest price on or before the date, matching crop", () => {
    expect(latestPriceFor(prices, "rice", "2026-08-15")).toBe(0.3);
    expect(latestPriceFor(prices, "rice", "2026-08-10")).toBe(0.3);
    expect(latestPriceFor(prices, "rice", "2026-08-25")).toBe(0.31);
  });
  it("returns null when nothing on or before the date, or wrong crop", () => {
    expect(latestPriceFor(prices, "rice", "2026-07-31")).toBeNull();
    expect(latestPriceFor(prices, "maize", "2026-08-15")).toBeNull();
    expect(latestPriceFor([], "rice", "2026-08-15")).toBeNull();
  });
});

describe("settlementMath", () => {
  it("gross = sum of weight×price, deductions = deductible advances only, net = difference", () => {
    const r = settlementMath(
      [{ gross_weight_kg: 1000, price_per_kg_applied: 0.3 }, { gross_weight_kg: 500, price_per_kg_applied: 0.28 }],
      [{ total_cost: 120, deduct_at_settlement: true }, { total_cost: 999, deduct_at_settlement: false }],
    );
    expect(r).toEqual({ gross: 440, deductions: 120, net: 320 });
  });
  it("handles empty sets", () => {
    expect(settlementMath([], [])).toEqual({ gross: 0, deductions: 0, net: 0 });
  });
  it("rounds to 2dp and allows negative net", () => {
    const r = settlementMath([{ gross_weight_kg: 3, price_per_kg_applied: 0.333 }], [{ total_cost: 10, deduct_at_settlement: true }]);
    expect(r.gross).toBe(1);           // 0.999 -> 1.00
    expect(r.net).toBe(-9);
  });
  it("gross sums per-line rounded values, not round2 of the raw sum", () => {
    // Two lines of 30.015 each: per-line round2 -> 30.02 + 30.02 = 60.04.
    // The old behaviour (round2 of the raw sum 60.03) would give 60.03 —
    // this pins the new per-line-rounding so the printed slip's line items
    // always add up to the printed gross.
    const r = settlementMath(
      [
        { gross_weight_kg: 30.015, price_per_kg_applied: 1 },
        { gross_weight_kg: 30.015, price_per_kg_applied: 1 },
      ],
      [],
    );
    expect(r.gross).toBe(60.04);
  });
});

describe("performanceRatio", () => {
  it("delivered over expected", () => {
    expect(performanceRatio(8000, 10000)).toBeCloseTo(0.8);
    expect(performanceRatio(12000, 10000)).toBeCloseTo(1.2);
  });
  it("null when expected missing or zero", () => {
    expect(performanceRatio(8000, null)).toBeNull();
    expect(performanceRatio(8000, 0)).toBeNull();
    expect(performanceRatio(8000, undefined)).toBeNull();
  });
});

describe("helpers", () => {
  it("round2", () => { expect(round2(1.005)).toBe(1.01); expect(round2(2)).toBe(2); });
  it("fmtUsd", () => {
    expect(fmtUsd(1234.5)).toBe("$1,234.50");
    expect(fmtUsd(0)).toBe("$0.00");
    expect(fmtUsd(null)).toBe("—");
  });
  it("deliveryValue", () => {
    expect(deliveryValue({ gross_weight_kg: 1000, price_per_kg_applied: 0.305 })).toBe(305);
  });
  it("genCode shape", () => { expect(genCode("CT")).toMatch(/^CT-\d{6}$/); });
});

describe("untestedDeliveryIds", () => {
  const qc = (delivery_id: string, test_type: string) => ({ delivery_id, test_type });
  it("returns ids with no moisture test", () => {
    expect(untestedDeliveryIds(["a", "b", "c"], [qc("a", "moisture"), qc("c", "pesticide")])).toEqual(["b", "c"]);
  });
  it("empty when all tested", () => {
    expect(untestedDeliveryIds(["a"], [qc("a", "moisture")])).toEqual([]);
  });
  it("a failed or pending moisture test still counts as tested", () => {
    // The gate requires the test to be RECORDED, not passed — wet paddy is
    // still paid for at the gate, drying happens after.
    expect(untestedDeliveryIds(["a"], [qc("a", "moisture")])).toEqual([]);
  });
  it("empty input", () => {
    expect(untestedDeliveryIds([], [])).toEqual([]);
  });
});
