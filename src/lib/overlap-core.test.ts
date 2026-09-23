import { describe, expect, it } from "vitest";
import type { PolygonGeo } from "./firms-core";
import { findOverlaps, polygonsOverlap, type OverlapParcel } from "./overlap-core";

/** Closed square from corner (lng, lat) with the given side in degrees. */
const square = (lng: number, lat: number, side: number): PolygonGeo => ({
  type: "Polygon",
  coordinates: [[
    [lng, lat],
    [lng + side, lat],
    [lng + side, lat + side],
    [lng, lat + side],
    [lng, lat],
  ]],
});

const A = square(105.01, 12.58, 0.01);

describe("polygonsOverlap", () => {
  it("returns null for parcels far apart", () => {
    expect(polygonsOverlap(A, square(105.2, 12.9, 0.01))).toBeNull();
  });

  it("returns null for parcels that merely share an edge", () => {
    // Abutting fields are normal and must not be flagged.
    expect(polygonsOverlap(A, square(105.02, 12.58, 0.01))).toBeNull();
  });

  it("detects partially overlapping parcels", () => {
    expect(polygonsOverlap(A, square(105.015, 12.585, 0.01))).toBe("crosses");
  });

  it("detects a parcel drawn wholly inside another", () => {
    expect(polygonsOverlap(A, square(105.013, 12.583, 0.002))).toBe("a_contains_b");
  });

  it("names the containment direction the other way round", () => {
    expect(polygonsOverlap(square(105.013, 12.583, 0.002), A)).toBe("b_contains_a");
  });

  it("catches the same field drawn twice", () => {
    // No edge strictly crosses and every vertex sits on the other boundary —
    // the centroid test is what saves this case.
    expect(polygonsOverlap(A, square(105.01, 12.58, 0.01))).toBe("a_contains_b");
  });

  it("ignores a degenerate ring", () => {
    expect(polygonsOverlap(A, { type: "Polygon", coordinates: [] })).toBeNull();
  });
});

describe("findOverlaps", () => {
  const parcel = (id: string, poly: PolygonGeo): OverlapParcel => ({
    id,
    farm_code: `FRM-${id}`,
    farm_name: `Farm ${id}`,
    boundary: poly,
  });

  it("returns each colliding pair once", () => {
    const pairs = findOverlaps([
      parcel("1", A),
      parcel("2", square(105.015, 12.585, 0.01)),
      parcel("3", square(105.2, 12.9, 0.01)),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].a.id).toBe("1");
    expect(pairs[0].b.id).toBe("2");
    expect(pairs[0].kind).toBe("crosses");
  });

  it("never pairs a parcel with itself", () => {
    expect(findOverlaps([parcel("1", A)])).toEqual([]);
  });

  it("returns nothing when no parcel has a usable boundary", () => {
    expect(findOverlaps([parcel("1", { type: "Polygon", coordinates: [] })])).toEqual([]);
  });
});
