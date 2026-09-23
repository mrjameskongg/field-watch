import { describe, expect, it } from "vitest";
import {
  dispatchedByProduct,
  dispatchRevenue,
  nextDispatchCode,
  validateDispatch,
} from "./dispatch-core";

describe("nextDispatchCode", () => {
  it("starts at 001 for a fresh year", () => {
    expect(nextDispatchCode([], 2026)).toBe("DP-2026-001");
  });
  it("increments past the highest existing code and ignores other years", () => {
    expect(nextDispatchCode(["DP-2026-001", "DP-2026-007", "DP-2025-099"], 2026)).toBe("DP-2026-008");
  });
  it("ignores malformed codes", () => {
    expect(nextDispatchCode(["DP-2026-xyz", "junk"], 2026)).toBe("DP-2026-001");
  });
});

describe("dispatchedByProduct", () => {
  it("totals per product and ignores unknown products", () => {
    const t = dispatchedByProduct([
      { product: "milled_output", weight_kg: 1000, price_per_kg: 0.9 },
      { product: "milled_output", weight_kg: 500, price_per_kg: null },
      { product: "bran", weight_kg: 200, price_per_kg: 0.1 },
      { product: "mystery", weight_kg: 999, price_per_kg: null },
    ]);
    expect(t.milled_output).toBe(1500);
    expect(t.bran).toBe(200);
    expect(t.broken).toBe(0);
    expect(t.husk).toBe(0);
  });
});

describe("dispatchRevenue", () => {
  it("sums priced dispatches and counts unpriced separately", () => {
    const r = dispatchRevenue([
      { product: "milled_output", weight_kg: 1000, price_per_kg: 0.9 },
      { product: "bran", weight_kg: 200, price_per_kg: 0.1 },
      { product: "husk", weight_kg: 300, price_per_kg: null },
    ]);
    expect(r.revenue).toBe(920);
    expect(r.unpricedCount).toBe(1);
  });
});

describe("validateDispatch", () => {
  const ok = { buyerId: "b1", product: "bran", weightKg: 100, pricePerKg: 0.1 };
  it("accepts a valid dispatch", () => {
    expect(validateDispatch(ok, 1570)).toBeNull();
  });
  it("rejects missing buyer, bad product, non-positive weight, negative price", () => {
    expect(validateDispatch({ ...ok, buyerId: "" }, 1570)).toBe("dispatch.errBuyer");
    expect(validateDispatch({ ...ok, product: "gold" }, 1570)).toBe("dispatch.errProduct");
    expect(validateDispatch({ ...ok, weightKg: 0 }, 1570)).toBe("dispatch.errWeight");
    expect(validateDispatch({ ...ok, pricePerKg: -1 }, 1570)).toBe("dispatch.errPrice");
  });
  it("rejects dispatching more than is on hand", () => {
    expect(validateDispatch({ ...ok, weightKg: 2000 }, 1570)).toBe("dispatch.errOverStock");
  });
});
