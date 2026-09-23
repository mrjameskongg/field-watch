import { describe, expect, it } from "vitest";
import { attachHotspot, type ParcelForMatch, type PolygonGeo, inZone, zoneBbox } from "./firms-core";

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

const withPolygon: ParcelForMatch = {
  id: "poly",
  farm_name: "Poly Farm",
  farmer_id: "f1",
  latitude: 12.5845,
  longitude: 105.0146,
  boundary_geojson: square,
};
const pointOnly: ParcelForMatch = {
  id: "pt",
  farm_name: "Point Farm",
  farmer_id: "f2",
  latitude: 12.6,
  longitude: 105.03,
  boundary_geojson: null,
};

describe("attachHotspot", () => {
  it("attaches by polygon containment even when another point is nearer", () => {
    // hotspot inside the square but geometrically nearer to pointOnly's GPS point
    const r = attachHotspot({ latitude: 12.5888, longitude: 105.019 }, [pointOnly, withPolygon]);
    expect(r.attached?.farm.id).toBe("poly");
    expect(r.attached?.byPolygon).toBe(true);
  });
  it("falls back to nearest point within 1 km", () => {
    const r = attachHotspot({ latitude: 12.601, longitude: 105.031 }, [pointOnly, withPolygon]);
    expect(r.attached?.farm.id).toBe("pt");
    expect(r.attached?.byPolygon).toBe(false);
  });
  it("attaches nothing when outside every polygon and > 1 km from every point", () => {
    const r = attachHotspot({ latitude: 12.7, longitude: 105.2 }, [pointOnly, withPolygon]);
    expect(r.attached).toBeNull();
    expect(r.nearest).not.toBeNull();
  });
  it("ignores malformed boundary_geojson without throwing", () => {
    const bad: ParcelForMatch = { ...pointOnly, id: "bad", boundary_geojson: { nope: 1 } };
    const r = attachHotspot({ latitude: 12.7, longitude: 105.2 }, [bad]);
    expect(r.attached).toBeNull();
  });
});

describe("burn zone polygon", () => {
  it("accepts the estate centroid and the own block, rejects the old 105.02 E point", () => {
    expect(inZone({ latitude: 12.5591, longitude: 104.9147 })).toBe(true);
    expect(inZone({ latitude: 12.5633, longitude: 104.9317 })).toBe(true); // own plot 01
    expect(inZone({ latitude: 12.5844, longitude: 105.0197 })).toBe(false);
  });
  it("keeps a 1 km buffer outside the ring", () => {
    // ~600 m south of the southern-most vertex (12.5369716 N, 104.9254785 E)
    expect(inZone({ latitude: 12.5316, longitude: 104.9254785 })).toBe(true);
    // ~3 km south
    expect(inZone({ latitude: 12.5099, longitude: 104.9254785 })).toBe(false);
  });
  it("bboxes the ring plus buffer", () => {
    const [w, s, e, n] = zoneBbox().split(",").map(Number);
    expect(w).toBeLessThan(104.886276);
    expect(e).toBeGreaterThan(104.9410272);
    expect(s).toBeLessThan(12.5369716);
    expect(n).toBeGreaterThan(12.5888271);
  });
});
