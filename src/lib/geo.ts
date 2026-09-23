// App-side polygon helpers for parcel boundaries. Pure functions, unit-tested.
// The containment test lives in firms-core.ts because the burn-scan edge
// function needs it too.
import type { PolygonGeo } from "./firms-core";
export { pointInPolygon, type PolygonGeo } from "./firms-core";

const EARTH_R = 6371000;

/** Shoelace area on an equirectangular projection — accurate to well under 1% at parcel scale. */
export function polygonAreaHa(poly: PolygonGeo): number {
  const ring = poly.coordinates?.[0] ?? [];
  if (ring.length < 4) return 0; // closed ring of a triangle has 4 points
  const lat0 = (ring.reduce((s, [, lat]) => s + lat, 0) / ring.length) * (Math.PI / 180);
  const pts = ring.map(([lng, lat]) => [
    ((lng * Math.PI) / 180) * EARTH_R * Math.cos(lat0),
    ((lat * Math.PI) / 180) * EARTH_R,
  ]);
  let sum = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    sum += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return Math.abs(sum / 2) / 10000;
}

export function segmentsIntersect(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): boolean {
  const cross = (o: [number, number], p: [number, number], q: [number, number]) =>
    (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Validate an open or closed ring drawn by the user.
 * Returns null when valid, otherwise a plain-English reason.
 */
export function validatePolygon(ring: [number, number][]): string | null {
  // Treat a closed ring (first == last) as its open form for counting.
  const open =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;
  const distinct = open.filter(
    (p, i) => i === 0 || p[0] !== open[i - 1][0] || p[1] !== open[i - 1][1],
  );
  if (distinct.length < 3) return "A boundary needs at least 3 corner points.";
  if (distinct.length > 200) return "Too many points — simplify the boundary (max 200 corners).";
  // Self-intersection: compare every non-adjacent edge pair of the closed ring.
  const closed = [...distinct, distinct[0]];
  for (let i = 0; i < closed.length - 1; i++) {
    for (let j = i + 2; j < closed.length - 1; j++) {
      if (i === 0 && j === closed.length - 2) continue; // first and last edge share a vertex
      if (segmentsIntersect(closed[i], closed[i + 1], closed[j], closed[j + 1])) {
        return "The boundary crosses itself — redraw it.";
      }
    }
  }
  return null;
}

/** Leaflet latlngs → closed GeoJSON Polygon ([lng, lat] order). */
export function toPolygonGeo(latlngs: { lat: number; lng: number }[]): PolygonGeo {
  const ring = latlngs.map(({ lat, lng }) => [lng, lat] as [number, number]);
  if (ring.length > 0) ring.push([...ring[0]] as [number, number]);
  return { type: "Polygon", coordinates: [ring] };
}

/**
 * Area-weighted centroid of a polygon ring (the shoelace centroid), which is
 * the point a plot-location field wants — not the average of the vertices,
 * which drifts toward whichever edge was drawn with more clicks.
 */
export function polygonCentroid(ring: [number, number][]): { lat: number; lon: number } | null {
  if (ring.length < 3) return null;
  // Drop a repeated closing vertex so it does not weigh twice.
  const pts =
    ring.length > 3 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;
  if (pts.length < 3) return null;

  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const cross = x0 * y1 - x1 * y0;
    twiceArea += cross;
    x += (x0 + x1) * cross;
    y += (y0 + y1) * cross;
  }
  if (twiceArea === 0) return null; // degenerate ring — every point collinear
  const factor = 1 / (3 * twiceArea);
  return { lon: x * factor, lat: y * factor };
}
