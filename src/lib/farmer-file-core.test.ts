import { describe, expect, it } from "vitest";
import { farmerDocs, type FarmerFileInput } from "./farmer-file-core";

const empty = (over: Partial<FarmerFileInput> = {}): FarmerFileInput => ({
  phone: null,
  mappedFarms: 0,
  totalFarms: 0,
  contracts: [],
  advanceCount: 0,
  deliveries: [],
  moistureTestedDeliveryIds: new Set(),
  activeBurnAlerts: 0,
  ...over,
});

const state = (input: FarmerFileInput) =>
  Object.fromEntries(farmerDocs(input).map((d) => [d.key, d.state]));

describe("farmerDocs", () => {
  it("brand-new farmer: bio is the current step, everything else pending", () => {
    expect(state(empty())).toEqual({
      bio: "current",
      purchase: "pending",
      lending: "pending",
      receipts: "pending",
      testing: "pending",
    });
  });

  it("bio needs BOTH a phone and a mapped farm", () => {
    expect(state(empty({ phone: "012" })).bio).toBe("current");
    expect(state(empty({ mappedFarms: 1, totalFarms: 1 })).bio).toBe("current");
    const s = state(empty({ phone: "012", mappedFarms: 1, totalFarms: 1 }));
    expect(s.bio).toBe("done");
    expect(s.purchase).toBe("current");
  });

  it("cancelled contracts do not count as a purchase document", () => {
    const s = state(
      empty({
        phone: "012",
        mappedFarms: 1,
        contracts: [{ id: "c1", status: "cancelled", expected_yield_kg: 1000 }],
      }),
    );
    expect(s.purchase).toBe("current");
    expect(s.lending).toBe("pending"); // no live contract, so lending not yet optional
  });

  it("lending is na (optional) once a contract exists without an advance", () => {
    const s = state(
      empty({
        phone: "012",
        mappedFarms: 1,
        contracts: [{ id: "c1", status: "active", expected_yield_kg: 1000 }],
      }),
    );
    expect(s.lending).toBe("na");
    expect(s.receipts).toBe("current");
  });

  it("advance recorded makes lending done", () => {
    const s = state(
      empty({
        contracts: [{ id: "c1", status: "active", expected_yield_kg: null }],
        advanceCount: 2,
      }),
    );
    expect(s.lending).toBe("done");
  });

  it("delivered over the contracted estimate flags receipts as attention", () => {
    const s = state(
      empty({
        phone: "012",
        mappedFarms: 1,
        contracts: [{ id: "c1", status: "active", expected_yield_kg: 1000 }],
        deliveries: [{ id: "d1", gross_weight_kg: 1500 }],
        moistureTestedDeliveryIds: new Set(["d1"]),
      }),
    );
    expect(s.receipts).toBe("attention");
    expect(s.testing).toBe("done");
  });

  it("untested delivery flags testing as attention", () => {
    const s = state(
      empty({
        contracts: [{ id: "c1", status: "active", expected_yield_kg: 5000 }],
        deliveries: [
          { id: "d1", gross_weight_kg: 100 },
          { id: "d2", gross_weight_kg: 100 },
        ],
        moistureTestedDeliveryIds: new Set(["d1"]),
      }),
    );
    expect(s.testing).toBe("attention");
  });

  it("active burn alert flags testing even with zero deliveries", () => {
    const s = state(empty({ activeBurnAlerts: 1 }));
    expect(s.testing).toBe("attention");
  });

  it("fully complete farmer has no current step", () => {
    const docs = farmerDocs(
      empty({
        phone: "012",
        mappedFarms: 1,
        totalFarms: 1,
        contracts: [{ id: "c1", status: "completed", expected_yield_kg: 2000 }],
        advanceCount: 1,
        deliveries: [{ id: "d1", gross_weight_kg: 1800 }],
        moistureTestedDeliveryIds: new Set(["d1"]),
      }),
    );
    expect(docs.every((d) => d.state !== "current" && d.state !== "pending")).toBe(true);
  });

  it("an attention doc absorbs the current slot — nothing later goes amber", () => {
    // Receipts over contract; testing untested would be attention anyway,
    // but purchase/lending done, so first pending-or-attention = receipts.
    const docs = farmerDocs(
      empty({
        phone: "012",
        mappedFarms: 1,
        contracts: [{ id: "c1", status: "active", expected_yield_kg: 100 }],
        advanceCount: 1,
        deliveries: [{ id: "d1", gross_weight_kg: 500 }],
        moistureTestedDeliveryIds: new Set(),
      }),
    );
    const states = docs.map((d) => d.state);
    expect(states).toEqual(["done", "done", "done", "attention", "attention"]);
    expect(states.includes("current")).toBe(false);
  });

  it("always returns the 5 docs in James's order", () => {
    expect(farmerDocs(empty()).map((d) => d.key)).toEqual([
      "bio",
      "purchase",
      "lending",
      "receipts",
      "testing",
    ]);
  });
});
