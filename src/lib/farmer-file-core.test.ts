import { describe, expect, it } from "vitest";
import { farmerDocs, farmerStory, type FarmerFileInput, type StoryInput } from "./farmer-file-core";

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

// Chan Sophea's record as the demo shows it (CT-2026-001).
const chan = (over: Partial<StoryInput> = {}): StoryInput => ({
  name: "Chan Sophea",
  gender: "female",
  village: "Ou Svay",
  district: "Baray",
  province: "Kampong Thom",
  registrationDate: "2022-11-03",
  farms: [{ hectares: 2.4, mapped: true }],
  contract: { crop: "rice", hectares: 2.4, expectedKg: 12700, priceMode: "fixed", fixedPrice: 0.3, currency: "USD" },
  otherLiveContracts: 0,
  advances: [
    { itemType: "fertilizer", cost: 155, currency: "USD" },
    { itemType: "seed", cost: 80, currency: "USD" },
  ],
  expectedKg: 12700,
  deliveredKg: 12220,
  rank: { position: 2, of: 5, grade: "A" },
  loads: 2,
  testedLoads: 2,
  failedLoads: 0,
  wetLoads: 0,
  fires: { count: 0, inside: 0, window: "1 Jan to 30 Apr 2026" },
  openBurnAlerts: 0,
  ...over,
});

describe("farmerStory", () => {
  it("tells Chan Sophea's five documents in plain sentences", () => {
    const s = farmerStory(chan());
    expect(s.bio).toBe("Chan Sophea farms in Ou Svay, Baray, Kampong Thom. 1 field mapped, 2.4 ha. Registered 2022.");
    expect(s.purchase).toBe("Agreed to sell 12,700 kg of rice from 2.4 ha (5.3 t/ha) at a fixed $0.30/kg.");
    expect(s.lending).toBe("$235.00 of fertilizer and seed on credit, taken back from her payment.");
    expect(s.receipts).toBe("Delivered 12,220 kg, 96% of the estimate. Ranked 2nd of 5 this season (grade A).");
    expect(s.testing).toBe(
      "Both loads moisture-tested and passed. No fire detected within 1 km of her field, 1 Jan to 30 Apr 2026 (NASA FIRMS).",
    );
  });

  it("says market price when the contract is not fixed", () => {
    const s = farmerStory(chan({ contract: { crop: "rice", hectares: 3.1, expectedKg: 15500, priceMode: "market", fixedPrice: null, currency: "USD" } }));
    expect(s.purchase).toBe("Agreed to sell 15,500 kg of rice from 3.1 ha (5.0 t/ha) at the market price on the day of delivery.");
  });

  it("handles a farmer with nothing yet, and no recorded gender", () => {
    const s = farmerStory(chan({
      gender: null, village: null, district: null, province: null, registrationDate: null, farms: [],
      contract: null, advances: [], expectedKg: 0, deliveredKg: 0, rank: null, loads: 0, testedLoads: 0, fires: null,
    }));
    expect(s.bio).toBe("Chan Sophea farms in a place not recorded yet. No field registered yet.");
    expect(s.purchase).toBe("No purchase agreement yet.");
    expect(s.lending).toBe("No inputs on credit.");
    expect(s.receipts).toBe("Nothing delivered yet.");
    expect(s.testing).toBe("No loads delivered yet, so nothing to test. Field not mapped, so the fire check cannot run.");
  });

  it("uses the farmer's name when gender is not recorded", () => {
    expect(farmerStory(chan({ gender: null })).lending).toContain("taken back from Chan Sophea's payment");
  });

  it("flags untested, failed and wet loads", () => {
    expect(farmerStory(chan({ loads: 3, testedLoads: 2, failedLoads: 1, wetLoads: 1 })).testing).toBe(
      "1 load failed the moisture test. 1 of 3 loads not moisture-tested yet. 1 load came in over 24% moisture. No fire detected within 1 km of her field, 1 Jan to 30 Apr 2026 (NASA FIRMS).",
    );
  });

  it("reports fires near the field, and an open burn alert first", () => {
    expect(farmerStory(chan({ fires: { count: 3, inside: 0, window: "1 Jan to 30 Apr 2026" } })).testing).toContain(
      "3 fires detected within 1 km of her field, none inside it, 1 Jan to 30 Apr 2026 (NASA FIRMS). The ranking counts only open burn alerts.",
    );
    expect(farmerStory(chan({ fires: { count: 2, inside: 1, window: "1 Jan to 30 Apr 2026" } })).testing).toContain(
      "2 fires detected within 1 km of her field, 1 inside it, 1 Jan to 30 Apr 2026 (NASA FIRMS). The ranking counts only open burn alerts.",
    );
    // No drawn boundary: "inside" is unknown, so the sentence does not claim it.
    expect(farmerStory(chan({ fires: { count: 3, inside: null, window: "1 Jan to 30 Apr 2026" } })).testing).toContain(
      "3 fires detected within 1 km of her field, 1 Jan to 30 Apr 2026 (NASA FIRMS). The ranking counts only open burn alerts.",
    );
    expect(farmerStory(chan({ openBurnAlerts: 1 })).testing).toBe("Both loads moisture-tested and passed. Open burn alert: check the field.");
  });

  it("counts unmapped fields and extra contracts", () => {
    const s = farmerStory(chan({ farms: [{ hectares: 2, mapped: true }, { hectares: 1.1, mapped: false }], otherLiveContracts: 1 }));
    expect(s.bio).toContain("2 fields, 1 mapped, 3.1 ha.");
    expect(s.purchase).toContain("1 more contract on file.");
  });
});

