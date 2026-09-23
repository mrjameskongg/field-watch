import { describe, expect, it } from "vitest";
import { asCurrency, fmtMoney, sumByCurrency, usdEquivalent } from "./money-core";

describe("fmtMoney", () => {
  it("formats USD with two decimals and a leading dollar", () => {
    expect(fmtMoney(1490.6, "USD")).toBe("$1,490.60");
    expect(fmtMoney(-12.5, "USD")).toBe("-$12.50");
  });
  it("formats KHR with no decimals and a trailing riel sign", () => {
    expect(fmtMoney(6706500, "KHR")).toBe("6,706,500 ៛");
    expect(fmtMoney(850, "KHR")).toBe("850 ៛");
    expect(fmtMoney(-850, "KHR")).toBe("-850 ៛");
  });
  it("defaults to USD when currency is missing", () => {
    expect(fmtMoney(3, null)).toBe("$3.00");
    expect(fmtMoney(3)).toBe("$3.00");
  });
  it("renders a dash for null/undefined", () => {
    expect(fmtMoney(null, "KHR")).toBe("—");
    expect(fmtMoney(undefined, "USD")).toBe("—");
  });
});

describe("usdEquivalent", () => {
  it("divides KHR by the rate and passes USD through", () => {
    expect(usdEquivalent(4100, "KHR", 4100)).toBe(1);
    expect(usdEquivalent(6706500, "KHR", 4100)).toBeCloseTo(1635.73, 2);
    expect(usdEquivalent(12.34, "USD", 4100)).toBe(12.34);
  });
  it("returns 0 for a missing or zero rate instead of Infinity", () => {
    expect(usdEquivalent(100, "KHR", 0)).toBe(0);
  });
});

describe("sumByCurrency", () => {
  it("buckets amounts by currency, defaulting missing currency to USD", () => {
    const rows = [
      { v: 10, c: "USD" as const },
      { v: 20, c: "KHR" as const },
      { v: 5, c: null },
    ];
    expect(sumByCurrency(rows, (r) => r.v, (r) => r.c)).toEqual({ USD: 15, KHR: 20 });
  });
});

describe("asCurrency", () => {
  it("accepts KHR/USD and falls back to USD", () => {
    expect(asCurrency("KHR")).toBe("KHR");
    expect(asCurrency("USD")).toBe("USD");
    expect(asCurrency("eur")).toBe("USD");
    expect(asCurrency(undefined)).toBe("USD");
  });
});
