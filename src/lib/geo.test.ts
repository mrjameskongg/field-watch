import { describe, expect, it } from "vitest";
import { pointInPolygon, type PolygonGeo } from "./firms-core";
import { polygonAreaHa, toPolygonGeo, validatePolygon } from "./geo";

// ~1 km square near the BRM estate (lat 12.58, lng 105.01), GeoJSON [lng, lat]
const square: PolygonGeo = {
  type: "Polygon",
  coordinates: [[
    [105.01, 12.58],
    [105.0192, 12.58],
    [105.0192, 12.589],
    [105.01, 12.589],
    [105.01, 12.58],
  ]],
};

describe("pointInPolygon", () => {
  it("detects a point inside", () => {
    expect(pointInPolygon(12.5845, 105.0146, square)).toBe(true);
  });
  it("detects a point outside", () => {
    expect(pointInPolygon(12.6, 105.05, square)).toBe(false);
  });
  it("handles an empty polygon", () => {
    expect(pointInPolygon(12.58, 105.01, { type: "Polygon", coordinates: [] })).toBe(false);
  });
});

describe("polygonAreaHa", () => {
  it("computes ~100 ha for a ~1km square", () => {
    const ha = polygonAreaHa(square);
    expect(ha).toBeGreaterThan(90);
    expect(ha).toBeLessThan(110);
  });
  it("returns 0 for degenerate input", () => {
    expect(polygonAreaHa({ type: "Polygon", coordinates: [[[105, 12], [105.01, 12]]] })).toBe(0);
  });
});

describe("validatePolygon", () => {
  const ring = square.coordinates[0];
  it("accepts a valid ring", () => {
    expect(validatePolygon(ring)).toBeNull();
  });
  it("rejects fewer than 3 distinct points", () => {
    expect(validatePolygon([[105, 12], [105.01, 12], [105, 12]])).toMatch(/at least 3/i);
  });
  it("rejects more than 200 points", () => {
    const big = Array.from({ length: 201 }, (_, i) => [105 + i * 1e-6, 12] as [number, number]);
    expect(validatePolygon(big)).toMatch(/too many/i);
  });
  it("rejects a self-intersecting bowtie", () => {
    const bowtie: [number, number][] = [
      [105.0, 12.0],
      [105.01, 12.01],
      [105.01, 12.0],
      [105.0, 12.01],
      [105.0, 12.0],
    ];
    expect(validatePolygon(bowtie)).toMatch(/crosses itself/i);
  });
});

describe("toPolygonGeo", () => {
  it("converts leaflet latlngs and closes the ring", () => {
    const geo = toPolygonGeo([
      { lat: 12.58, lng: 105.01 },
      { lat: 12.58, lng: 105.02 },
      { lat: 12.59, lng: 105.02 },
    ]);
    const ring = geo.coordinates[0];
    expect(ring[0]).toEqual([105.01, 12.58]);
    expect(ring[ring.length - 1]).toEqual(ring[0]);
    expect(ring).toHaveLength(4);
  });
});
