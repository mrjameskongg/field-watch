import { describe, expect, it } from "vitest";
import {
  batchReadiness,
  buildBatchPack,
  buildEvidencePack,
  packCsv,
  packGeoJson,
  packReadiness,
  polygonCentroid,
  ringToWkt,
  type PackInput,
} from "./compliance-core";

const square: [number, number][] = [
  [105.0, 12.5],
  [105.01, 12.5],
  [105.01, 12.51],
  [105.0, 12.51],
  [105.0, 12.5],
];

const base: PackInput = {
  farmer: {
    full_name: "Sok Dara",
    farmer_code: "FRM-073349",
    village: "Trapeang Prei",
    commune: "Sankor",
    district: "Baray",
    province: "Kampong Thom",
    certifications: null,
  },
  contract: { contract_code: "CT-1", crop_type: "rice", season_label: "Wet 2026", signed_date: "2026-06-02" },
  parcels: [{ farm_code: "F-1", farm_name: "Field A", area_hectares: 5, boundary: square, land_tenure: "title", land_tenure_ref: "T-9910" }],
  deliveries: [
    { received_date: "2026-11-18", gross_weight_kg: 11840, batch_code: "B26-1" },
    { received_date: "2026-11-20", gross_weight_kg: 2000, batch_code: "B26-1" },
  ],
  waterEvents: [
    { event_type: "water", water_state: "drained", event_date: "2026-07-10" },
    { event_type: "water", water_state: "drained", event_date: "2026-08-14" },
  ],
  waterChecks: [{ agreement: "agrees" }, { agreement: "agrees" }, { agreement: "disagrees" }],
  burnAlerts: 0,
};

describe("polygonCentroid", () => {
  it("finds the middle of a square", () => {
    const c = polygonCentroid(square)!;
    expect(c.lon).toBeCloseTo(105.005, 5);
    expect(c.lat).toBeCloseTo(12.505, 5);
  });
  it("null for a ring that cannot make an area", () => {
    expect(polygonCentroid([])).toBeNull();
    expect(polygonCentroid([[105, 12], [105, 12], [105, 12]])).toBeNull();
  });
});

describe("buildEvidencePack", () => {
  it("carries the supplier, plot and quantity an origin claim needs", () => {
    const p = buildEvidencePack(base);
    expect(p.supplier.name).toBe("Sok Dara");
    expect(p.supplier.address).toBe("Trapeang Prei, Sankor, Baray, Kampong Thom");
    expect(p.plots).toHaveLength(1);
    expect(p.plots[0].centroid_lat).toBeCloseTo(12.505, 4);
    expect(p.plots[0].area_hectares).toBe(5);
    expect(p.quantity_kg).toBe(13840);
    expect(p.production_period).toEqual({ from: "2026-06-02", to: "2026-11-20" });
    expect(p.batch_codes).toEqual(["B26-1"]);
  });

  it("summarises the water practice and its radar backing", () => {
    const p = buildEvidencePack(base);
    expect(p.practice.awd_cycles).toBe(2);
    expect(p.practice.radar_passes).toBe(3);
    expect(p.practice.radar_agreement_pct).toBe(67);
    expect(p.practice.verdict).toBe("partial");
    expect(p.practice.burn_alerts).toBe(0);
  });

  it("production period starts at the earliest known date, signed or not", () => {
    const p = buildEvidencePack({
      ...base,
      contract: { ...base.contract, signed_date: null },
    });
    // With no signing date the first logged field event opens the period.
    expect(p.production_period.from).toBe("2026-07-10");
  });

  it("handles a farmer with nothing recorded yet", () => {
    const p = buildEvidencePack({
      ...base,
      parcels: [],
      deliveries: [],
      waterEvents: [],
      waterChecks: [],
    });
    expect(p.plots).toEqual([]);
    expect(p.quantity_kg).toBe(0);
    expect(p.production_period.to).toBe("2026-06-02");
    expect(p.practice.verdict).toBe("none");
  });
});

describe("packReadiness", () => {
  it("is complete when plot, quantity and radar backing are all present", () => {
    const r = packReadiness(buildEvidencePack(base));
    expect(r.missing).toEqual([]);
    expect(r.ready).toBe(true);
  });

  it("names an unmapped plot as the blocker", () => {
    const r = packReadiness(buildEvidencePack({ ...base, parcels: [{ farm_code: "F-1", farm_name: "Field A", area_hectares: 5, boundary: null, land_tenure: "title", land_tenure_ref: null }] }));
    expect(r.ready).toBe(false);
    expect(r.missing.join(" ")).toMatch(/boundary/i);
  });

  it("names missing deliveries and missing radar backing separately", () => {
    const r = packReadiness(buildEvidencePack({ ...base, deliveries: [], waterChecks: [] }));
    expect(r.missing).toHaveLength(2);
    expect(r.missing.join(" ")).toMatch(/delivered/i);
    expect(r.missing.join(" ")).toMatch(/radar/i);
  });

  it("radar passes that were never decisive are a warning, not a missing scan", () => {
    // Re-running the scan would not help — the passes happened and could not
    // be judged, so it must not read the same as "no radar yet".
    const r = packReadiness(
      buildEvidencePack({ ...base, waterChecks: [{ agreement: "inconclusive" }, { agreement: "unconfirmed" }] }),
    );
    expect(r.missing.join(" ")).not.toMatch(/radar/i);
    expect(r.warnings.join(" ")).toMatch(/decisive/i);
  });

  it("a burn alert is a warning, not a missing record", () => {
    const r = packReadiness(buildEvidencePack({ ...base, burnAlerts: 2 }));
    expect(r.ready).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/burn/i);
  });
});

describe("packCsv", () => {
  it("writes a header and one row per plot", () => {
    const csv = packCsv([buildEvidencePack(base)]);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("centroid_lat");
    expect(lines[1]).toContain("FRM-073349");
    expect(lines[1]).toContain("13840");
  });

  it("still emits a row when a farmer has no mapped plot", () => {
    const csv = packCsv([buildEvidencePack({ ...base, parcels: [] })]);
    expect(csv.trim().split("\n")).toHaveLength(2);
  });

  it("quotes fields containing commas so columns cannot shift", () => {
    const csv = packCsv([buildEvidencePack(base)]);
    expect(csv).toContain('"Trapeang Prei, Sankor, Baray, Kampong Thom"');
  });
});

/** `base` with one parcel swapped in — every gap test varies only the plot. */
const withParcel = (parcel: Partial<PackInput["parcels"][number]>): PackInput => ({
  ...base,
  parcels: [{
    farm_code: "F-1",
    farm_name: "Field A",
    area_hectares: 5,
    boundary: square,
    land_tenure: "title",
    land_tenure_ref: "T-9910",
    ...parcel,
  }],
});

describe("ringToWkt", () => {
  it("writes a closed POLYGON in lon lat order", () => {
    expect(ringToWkt(square)).toBe(
      "POLYGON((105 12.5, 105.01 12.5, 105.01 12.51, 105 12.51, 105 12.5))",
    );
  });
  it("closes a ring that was left open", () => {
    expect(ringToWkt(square.slice(0, -1))).toContain(", 105 12.5))");
  });
  it("returns an empty string for a degenerate ring", () => {
    expect(ringToWkt([[105.01, 12.58]])).toBe("");
  });
});

describe("plot boundaries on the pack", () => {
  it("carries the full ring, not only the centroid", () => {
    const pack = buildEvidencePack(base);
    expect(pack.plots[0].boundary_wkt).toContain("POLYGON((");
    expect(pack.plots[0].boundary_geojson?.coordinates[0]).toHaveLength(5);
    expect(pack.plots[0].centroid_lat).toBeCloseTo(12.505, 4);
  });
  it("leaves boundary fields null when the parcel was never drawn", () => {
    const pack = buildEvidencePack(withParcel({ boundary: null }));
    expect(pack.plots[0].boundary_wkt).toBeNull();
    expect(pack.plots[0].boundary_geojson).toBeNull();
  });
  it("carries land tenure through to the plot", () => {
    expect(buildEvidencePack(base).plots[0].land_tenure).toBe("title");
  });
});

describe("packReadiness and the 4 ha rule", () => {
  it("blocks on an unmapped plot larger than 4 ha", () => {
    const r = packReadiness(buildEvidencePack(withParcel({ boundary: null, area_hectares: 12 })));
    expect(r.missing.join(" ")).toMatch(/over 4 ha/);
    expect(r.ready).toBe(false);
  });
  it("only warns on an unmapped plot of 4 ha or less", () => {
    const r = packReadiness(buildEvidencePack(withParcel({ boundary: null, area_hectares: 3 })));
    expect(r.missing.join(" ")).not.toMatch(/boundary/);
    expect(r.warnings.join(" ")).toMatch(/4 ha or less/);
  });
  it("names a plot only once", () => {
    const r = packReadiness(buildEvidencePack(withParcel({ boundary: null, area_hectares: 12 })));
    const mentions = [...r.missing, ...r.warnings].filter((m) => m.includes("F-1")).length;
    expect(mentions).toBe(1);
  });
  it("warns when land tenure is not recorded", () => {
    const r = packReadiness(buildEvidencePack(withParcel({ land_tenure: null })));
    expect(r.warnings.join(" ")).toMatch(/tenure/i);
  });
});

describe("packGeoJson", () => {
  it("emits one Feature per mapped plot", () => {
    const fc = packGeoJson([buildEvidencePack(base)]);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties.farm_code).toBe("F-1");
    expect(fc.features[0].properties.supplier_code).toBe("FRM-073349");
  });
  it("skips a plot with no boundary — a Feature needs geometry", () => {
    const fc = packGeoJson([buildEvidencePack(withParcel({ boundary: null }))]);
    expect(fc.features).toHaveLength(0);
  });
});

describe("packCsv gains the due-diligence columns", () => {
  it("writes the boundary and tenure columns", () => {
    const csv = packCsv([buildEvidencePack(base)]);
    const header = csv.split("\n")[0];
    expect(header).toContain("boundary_wkt");
    expect(header).toContain("land_tenure");
    expect(csv).toContain("T-9910");
  });
});

describe("buildBatchPack", () => {
  const packA = buildEvidencePack(base);
  const packB = buildEvidencePack({
    ...base,
    farmer: { ...base.farmer, full_name: "Chan Dara", farmer_code: "FRM-002" },
    contract: { contract_code: "CT-2", crop_type: "rice", season_label: "Wet 2026", signed_date: "2026-04-01" },
    parcels: [{ farm_code: "F-2", farm_name: "Field B", area_hectares: 3, boundary: square, land_tenure: "lease", land_tenure_ref: null }],
  });
  const batch = { batch_code: "B26-1", custody_model: "mass_balance" };

  it("keeps the delivered weight of the batch, not the sum of the contracts", () => {
    const bp = buildBatchPack({ batch, packs: [packA, packB], quantity_kg: 1500 });
    expect(bp.quantity_kg).toBe(1500);
  });

  it("lists every supplier and contract behind a mass-balance batch", () => {
    const bp = buildBatchPack({ batch, packs: [packA, packB], quantity_kg: 1500 });
    expect(bp.suppliers.map((s) => s.code).sort()).toEqual(["FRM-002", "FRM-073349"]);
    expect(bp.contract_codes.sort()).toEqual(["CT-1", "CT-2"]);
  });

  it("spans the production period of every contributing contract", () => {
    const bp = buildBatchPack({ batch, packs: [packA, packB], quantity_kg: 1500 });
    expect(bp.production_period.from).toBe("2026-04-01");
    expect(bp.production_period.to).toBe("2026-11-20");
  });

  it("deduplicates a plot that fed the batch through two contracts", () => {
    const bp = buildBatchPack({ batch, packs: [packA, packA], quantity_kg: 900 });
    expect(bp.plots).toHaveLength(1);
  });

  it("sums the practice evidence across contributing contracts", () => {
    const bp = buildBatchPack({ batch, packs: [packA, packB], quantity_kg: 1500 });
    expect(bp.practice.awd_cycles).toBe(packA.practice.awd_cycles + packB.practice.awd_cycles);
    expect(bp.practice.radar_passes).toBe(packA.practice.radar_passes + packB.practice.radar_passes);
  });

  it("calls the verdict mixed when contributing farmers disagree", () => {
    const clean = buildEvidencePack({ ...base, waterChecks: [{ agreement: "agrees" }] });
    const messy = buildEvidencePack({
      ...base,
      contract: { ...base.contract, contract_code: "CT-3" },
      waterChecks: [{ agreement: "disagrees" }],
    });
    const bp = buildBatchPack({ batch, packs: [clean, messy], quantity_kg: 100 });
    if (clean.practice.verdict !== messy.practice.verdict) {
      expect(bp.practice.verdict).toBe("mixed");
    }
  });

  it("reports readiness over the merged plots", () => {
    const unmapped = buildEvidencePack(withParcel({ boundary: null, area_hectares: 12 }));
    const bp = buildBatchPack({ batch: { batch_code: "B26-2", custody_model: "identity_preserved" }, packs: [unmapped], quantity_kg: 400 });
    const r = batchReadiness(bp);
    expect(r.ready).toBe(false);
    expect(r.missing.join(" ")).toMatch(/over 4 ha/);
  });

  it("blocks a batch nothing was delivered into", () => {
    const bp = buildBatchPack({ batch, packs: [packA], quantity_kg: 0 });
    expect(batchReadiness(bp).missing.join(" ")).toMatch(/delivered into this batch/);
  });
});
