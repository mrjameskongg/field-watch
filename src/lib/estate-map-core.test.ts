import { describe, expect, it } from "vitest";
import {
  bboxOf,
  extrusionHeight,
  footprint,
  frameDates,
  ndviColor,
  orbitBearing,
  parcelFeatures,
  readingsAt,
  waterColor,
} from "./estate-map-core";
import { polygonAreaHa } from "./geo";

describe("extrusionHeight / colours", () => {
  it("scales NDVI to metres and floors missing readings", () => {
    expect(extrusionHeight(0.53)).toBeCloseTo(53, 5);
    expect(extrusionHeight(null)).toBe(4);
    expect(extrusionHeight(-0.1)).toBe(4);
  });
  it("ramps NDVI red → amber → green", () => {
    expect(ndviColor(0.28)).toBe("#ef4444");
    expect(ndviColor(0.53)).toBe("#f59e0b");
    expect(ndviColor(0.61)).toBe("#4ade80");
    expect(ndviColor(null)).toBe("#64748b");
  });
  it("colours water by state and dims unconfident passes", () => {
    expect(waterColor("flooded", true)).toBe("#7dd3fc");
    expect(waterColor("drained", true)).toBe("#4ade80");
    expect(waterColor("uncertain", true)).toBe("#94a3b8");
    expect(waterColor("drained", false)).toBe("#4ade8088");
    expect(waterColor(null, true)).toBe("#64748b");
  });
});

describe("frames", () => {
  const rows = [
    { farm_id: "a", reading_date: "2026-08-27", ndvi_mean: 0.5 },
    { farm_id: "a", reading_date: "2026-08-12", ndvi_mean: 0.4 },
    { farm_id: "b", reading_date: "2026-08-27", ndvi_mean: 0.6 },
    { farm_id: "b", reading_date: "2026-09-01", ndvi_mean: 0.7 },
  ];
  it("lists unique sorted dates", () => {
    expect(frameDates(rows)).toEqual(["2026-08-12", "2026-08-27", "2026-09-01"]);
  });
  it("picks the latest reading on or before the frame date per farm", () => {
    const at = readingsAt(rows, "2026-08-27");
    expect(at.get("a")?.ndvi_mean).toBe(0.5);
    expect(at.get("b")?.ndvi_mean).toBe(0.6);
    expect(readingsAt(rows, "2026-08-20").get("b")).toBeUndefined();
  });
});

describe("footprint", () => {
  it("draws a hexagon whose area matches the stated hectares within 2 %", () => {
    const poly = footprint(12.56, 104.92, 2.4);
    const ha = polygonAreaHa({ type: "Polygon", coordinates: poly.coordinates as [number, number][][] });
    expect(Math.abs(ha - 2.4) / 2.4).toBeLessThan(0.02);
    expect(poly.coordinates[0].length).toBe(7);
  });
  it("never draws smaller than a quarter hectare", () => {
    const ha = polygonAreaHa({ type: "Polygon", coordinates: footprint(12.56, 104.92, null).coordinates as [number, number][][] });
    expect(ha).toBeGreaterThan(0.24);
  });
});

describe("orbit + bbox", () => {
  it("wraps bearing around a full turn", () => {
    expect(orbitBearing(0)).toBe(20);
    expect(orbitBearing(12500)).toBe(200);
    expect(orbitBearing(25000)).toBe(20);
  });
  it("bounds a coordinate list", () => {
    expect(bboxOf([[104.9, 12.5], [104.95, 12.6], [104.92, 12.55]])).toEqual([104.9, 12.5, 104.95, 12.6]);
  });
});

describe("parcelFeatures", () => {
  const farms = [
    { id: "f1", farm_name: "Own plot 01", farmer: "BRM", latitude: 12.563, longitude: 104.931, area_hectares: 9,
      boundary_geojson: { type: "Polygon", coordinates: [[[104.93, 12.562], [104.934, 12.562], [104.934, 12.566], [104.93, 12.566], [104.93, 12.562]]] } },
    { id: "f2", farm_name: "Chan", farmer: "Chan Sophea", latitude: 12.5, longitude: 104.9, area_hectares: 2.4, boundary_geojson: null },
    { id: "f3", farm_name: "Nowhere", farmer: null, latitude: null, longitude: null, area_hectares: 1, boundary_geojson: null },
  ];
  const health = new Map([["f1", { farm_id: "f1", reading_date: "2026-08-27", ndvi_mean: 0.28 }]]);
  const water = new Map([["f2", { farm_id: "f2", reading_date: "2026-08-28", state: "flooded", confident: true }]]);
  it("uses the stored polygon when present and a footprint otherwise; skips farms with no location", () => {
    const fc = parcelFeatures(farms, health, water, "ndvi");
    expect(fc.features).toHaveLength(2);
    const f1 = fc.features.find((f) => f.properties?.id === "f1")!;
    expect(f1.geometry.type).toBe("Polygon");
    expect(f1.properties?.h).toBeCloseTo(28, 5);
    expect(f1.properties?.c).toBe("#ef4444");
    const f2 = fc.features.find((f) => f.properties?.id === "f2")!;
    expect((f2.geometry as GeoJSON.Polygon).coordinates[0]).toHaveLength(7);
    expect(f2.properties?.h).toBe(4);
  });
  it("switches colour to water state in water mode", () => {
    const fc = parcelFeatures(farms, health, water, "water");
    expect(fc.features.find((f) => f.properties?.id === "f2")?.properties?.c).toBe("#7dd3fc");
    expect(fc.features.find((f) => f.properties?.id === "f1")?.properties?.c).toBe("#64748b");
  });
});
