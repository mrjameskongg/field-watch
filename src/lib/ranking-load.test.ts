import { describe, expect, it } from "vitest";
import { currentSeasonInputs, type RankingData } from "./ranking-load";

const data = (): RankingData => ({
  farmers: [
    { id: "f1", full_name: "Chan Sophea", farmer_code: "FRM-100215" },
    { id: "own", full_name: "BRM Agro (own block)", farmer_code: "FRM-BRM-OWN" },
  ],
  farms: [{ farmer_id: "f1", latitude: 12.5, boundary_geojson: null }],
  contracts: [
    { id: "c1", farmer_id: "f1", status: "active", expected_yield_kg: 12700, currency: "USD", season_closed: false, season_label: "2026 dry season" },
    { id: "c0", farmer_id: "f1", status: "active", expected_yield_kg: 9000, currency: "USD", season_closed: true, season_label: "2025 wet season" },
    { id: "cx", farmer_id: "f1", status: "cancelled", expected_yield_kg: 5000, currency: "USD", season_closed: false, season_label: "2026 dry season" },
  ],
  burnAlerts: [],
  deliveries: [
    { id: "d1", contract_id: "c1", gross_weight_kg: 6240, moisture_flagged: false, price_per_kg_applied: 0.3 },
    { id: "d2", contract_id: "c1", gross_weight_kg: 5980, moisture_flagged: false, price_per_kg_applied: 0.3 },
    { id: "d0", contract_id: "c0", gross_weight_kg: 8000, moisture_flagged: false, price_per_kg_applied: 0.28 },
  ],
  qc: [
    { delivery_id: "d1", passed: false },
    { delivery_id: "d1", passed: true },
  ],
});

describe("currentSeasonInputs", () => {
  it("counts only open, uncancelled contracts and never ranks the estate's own block", () => {
    const inputs = currentSeasonInputs(data());
    expect(inputs.map((i) => i.farmerId)).toEqual(["f1"]);
    expect(inputs[0]).toMatchObject({ expectedKg: 12700, deliveredKg: 12220, totalLoads: 2, mapped: true, hasLiveContract: true });
  });
  it("counts a load as passed if any of its moisture tests passed", () => {
    expect(currentSeasonInputs(data())[0]).toMatchObject({ testedLoads: 1, passedLoads: 1 });
  });
});
