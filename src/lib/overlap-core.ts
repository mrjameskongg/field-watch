// Do two parcels claim the same ground?
//
// Nothing else in Field Watch answers this. Area, self-intersection and
// point-in-polygon are all covered (geo.ts, firms-core.ts); parcel-against-
// parcel is the gap, and it is the one that matters in an outgrower scheme —
// the same field registered twice, under two farmers, drawing inputs twice.
//
// Pure TypeScript on purpose. PostGIS would answer this with ST_Intersects,
// but it would also mean a second copy of every boundary to keep in step with
// boundary_geojson. At this parcel count the extension earns nothing. If the
// register ever reaches thousands of plots, swap findOverlaps for an RPC —
// callers only ever see OverlapPair.

import { pointInPolygon, type PolygonGeo } from "./firms-core";
import { polygonCentroid, segmentsIntersect } from "./geo";

export type Overlap = "crosses" | "a_contains_b" | "b_contains_a";

export type OverlapParcel = {
  id: string;
  farm_code: string;
  farm_name: string | null;
  boundary: PolygonGeo;
};

export type OverlapPair = { a: OverlapParcel; b: OverlapParcel; kind: Overlap };

type Box = { minLng: number; maxLng: number; minLat: number; maxLat: number };

/** Outer ring, open (no repeated closing vertex). Empty when unusable. */
function outerRing(poly: PolygonGeo): [number, number][] {
  const ring = poly?.coordinates?.[0] ?? [];
  if (ring.length < 3) return [];
  const last = ring.length - 1;
  const closed = ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1];
  const open = closed ? ring.slice(0, -1) : ring.slice();
  return open.length >= 3 ? open : [];
}

function bbox(ring: [number, number][]): Box {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLng, maxLng, minLat, maxLat };
}

const boxesDisjoint = (a: Box, b: Box): boolean =>
  a.maxLng < b.minLng || b.maxLng < a.minLng || a.maxLat < b.minLat || b.maxLat < a.minLat;

/**
 * Points that lie strictly inside `ring`: its centroid, plus every vertex
 * pulled halfway toward that centroid.
 *
 * Raw vertices cannot be used. Two parcels that merely abut share vertices,
 * and a point sitting exactly on a ray-cast polygon's edge reads as inside —
 * which would flag every neighbouring field in a paddy block. Pulling each
 * vertex inward moves it off the shared boundary without needing an epsilon.
 */
function interiorSamples(ring: [number, number][]): [number, number][] {
  const c = polygonCentroid(ring);
  if (!c) return []; // collinear ring — no interior to sample
  return [
    [c.lon, c.lat],
    ...ring.map(([lng, lat]) => [(lng + c.lon) / 2, (lat + c.lat) / 2] as [number, number]),
  ];
}

/** Does any interior point of `ring` fall inside `poly`? */
const interiorInside = (ring: [number, number][], poly: PolygonGeo): boolean =>
  interiorSamples(ring).some(([lng, lat]) => pointInPolygon(lat, lng, poly));

/**
 * Three stages, cheapest first. Returns null when the parcels do not conflict.
 *
 * Shared edges do NOT count: segmentsIntersect requires strictly opposite
 * cross-product signs, so parcels that abut along a boundary — the normal case
 * in a paddy block — come back clean.
 *
 * Known limit: for a strongly non-convex ring whose shoelace centroid falls
 * outside the shape, the interior samples are approximate and containment can
 * be missed. Field-drawn paddy plots are not that shape.
 */
export function polygonsOverlap(a: PolygonGeo, b: PolygonGeo): Overlap | null {
  const ra = outerRing(a);
  const rb = outerRing(b);
  if (ra.length === 0 || rb.length === 0) return null;

  // 1. Bounding boxes.
  if (boxesDisjoint(bbox(ra), bbox(rb))) return null;

  // 2. Edge crossings.
  const ca = [...ra, ra[0]];
  const cb = [...rb, rb[0]];
  for (let i = 0; i < ca.length - 1; i++) {
    for (let j = 0; j < cb.length - 1; j++) {
      if (segmentsIntersect(ca[i], ca[i + 1], cb[j], cb[j + 1])) return "crosses";
    }
  }

  // 3. Containment — no edge crosses, so either one parcel is inside the
  //    other, they are the same field drawn twice, or they merely touch.
  //    Sampling the interior tells those apart; sampling vertices could not.
  if (interiorInside(rb, a)) return "a_contains_b";
  if (interiorInside(ra, b)) return "b_contains_a";
  return null;
}

/** Every colliding pair, each reported once, in input order. */
export function findOverlaps(parcels: OverlapParcel[]): OverlapPair[] {
  const usable = parcels.filter((p) => outerRing(p.boundary).length > 0);
  const pairs: OverlapPair[] = [];
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const kind = polygonsOverlap(usable[i].boundary, usable[j].boundary);
      if (kind) pairs.push({ a: usable[i], b: usable[j], kind });
    }
  }
  return pairs;
}
