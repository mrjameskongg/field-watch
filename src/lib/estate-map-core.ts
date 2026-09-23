// Pure decisions behind the 3D estate map: heights, colours, season frames,
// footprints for point-only farms, and the orbit. No maplibre, no react.

// 100 m per unit NDVI: at estate zoom (~13) a 0.6 parcel stands 60 m tall — readable, not silly.
export const NDVI_HEIGHT_M = 100;
export const FLOOR_HEIGHT_M = 4;

export const COLOURS = {
  poor: "#ef4444",
  moderate: "#f59e0b",
  healthy: "#4ade80",
  none: "#64748b",
  flooded: "#7dd3fc",
  drained: "#4ade80",
  uncertain: "#94a3b8",
} as const;

export function extrusionHeight(ndvi: number | null | undefined): number {
  if (ndvi === null || ndvi === undefined || !Number.isFinite(ndvi) || ndvi <= 0) return FLOOR_HEIGHT_M;
  return Math.max(FLOOR_HEIGHT_M, ndvi * NDVI_HEIGHT_M);
}

export function ndviColor(ndvi: number | null | undefined): string {
  if (ndvi === null || ndvi === undefined || !Number.isFinite(ndvi)) return COLOURS.none;
  if (ndvi < 0.4) return COLOURS.poor;
  if (ndvi < 0.6) return COLOURS.moderate;
  return COLOURS.healthy;
}

export function waterColor(state: string | null | undefined, confident: boolean): string {
  const base =
    state === "flooded" ? COLOURS.flooded : state === "drained" ? COLOURS.drained : state === "uncertain" ? COLOURS.uncertain : null;
  if (!base) return COLOURS.none;
  return confident ? base : `${base}88`;
}

export function frameDates(rows: { reading_date: string }[]): string[] {
  return Array.from(new Set(rows.map((r) => r.reading_date.slice(0, 10)))).sort();
}

/** Latest reading on or before `date`, per farm. */
export function readingsAt<T extends { farm_id: string; reading_date: string }>(rows: T[], date: string): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) {
    const d = r.reading_date.slice(0, 10);
    if (d > date) continue;
    const held = out.get(r.farm_id);
    if (!held || held.reading_date.slice(0, 10) < d) out.set(r.farm_id, r);
  }
  return out;
}

const EARTH_M_PER_DEG_LAT = 111_320;

/** Regular hexagon of the stated area centred on the point (min 0.25 ha). */
export function footprint(lat: number, lon: number, hectares: number | null | undefined): GeoJSON.Polygon {
  const ha = Math.max(0.25, hectares ?? 0);
  const areaM2 = ha * 10_000;
  // Regular hexagon area = (3√3 / 2) r²
  const r = Math.sqrt((2 * areaM2) / (3 * Math.sqrt(3)));
  const mPerDegLon = EARTH_M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const ring: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    ring.push([
      Math.round((lon + (r * Math.cos(a)) / mPerDegLon) * 1e7) / 1e7,
      Math.round((lat + (r * Math.sin(a)) / EARTH_M_PER_DEG_LAT) * 1e7) / 1e7,
    ]);
  }
  ring.push(ring[0]);
  return { type: "Polygon", coordinates: [ring] };
}

export const ORBIT_PERIOD_MS = 25_000;
export const ORBIT_START_BEARING = 20;

export function orbitBearing(elapsedMs: number, periodMs = ORBIT_PERIOD_MS, start = ORBIT_START_BEARING): number {
  const turns = (elapsedMs % periodMs) / periodMs;
  return Math.round(((start + turns * 360) % 360) * 1e6) / 1e6;
}

export function bboxOf(coords: [number, number][]): [number, number, number, number] {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [x, y] of coords) {
    if (x < minLon) minLon = x;
    if (x > maxLon) maxLon = x;
    if (y < minLat) minLat = y;
    if (y > maxLat) maxLat = y;
  }
  return [minLon, minLat, maxLon, maxLat];
}

export type ParcelFarm = {
  id: string;
  farm_name: string;
  farmer: string | null;
  latitude: number | null;
  longitude: number | null;
  area_hectares: number | null;
  boundary_geojson: unknown;
};

export type HealthLite = { farm_id: string; reading_date: string; ndvi_mean: number };
export type WaterLite = { farm_id: string; reading_date: string; state: string; confident: boolean };
export type ColorMode = "ndvi" | "water";

export type ParcelProps = {
  id: string;
  name: string;
  farmer: string | null;
  h: number;
  c: string;
  ndvi: number | null;
  ndviDate: string | null;
  state: string | null;
  waterDate: string | null;
  ha: number | null;
};

function isPolygon(g: unknown): g is GeoJSON.Polygon {
  return !!g && typeof g === "object" && (g as { type?: string }).type === "Polygon" && Array.isArray((g as GeoJSON.Polygon).coordinates);
}

export function parcelFeatures(
  farms: ParcelFarm[],
  health: Map<string, HealthLite>,
  water: Map<string, WaterLite>,
  mode: ColorMode,
): GeoJSON.FeatureCollection<GeoJSON.Polygon, ParcelProps> {
  const features: GeoJSON.Feature<GeoJSON.Polygon, ParcelProps>[] = [];
  for (const f of farms) {
    let geometry: GeoJSON.Polygon | null = null;
    if (isPolygon(f.boundary_geojson)) geometry = f.boundary_geojson;
    else if (f.latitude !== null && f.longitude !== null) geometry = footprint(f.latitude, f.longitude, f.area_hectares);
    if (!geometry) continue;
    const hr = health.get(f.id);
    const wr = water.get(f.id);
    const ndvi = hr?.ndvi_mean ?? null;
    features.push({
      type: "Feature",
      geometry,
      properties: {
        id: f.id,
        name: f.farm_name,
        farmer: f.farmer,
        h: extrusionHeight(ndvi),
        c: mode === "ndvi" ? ndviColor(ndvi) : waterColor(wr?.state ?? null, wr?.confident ?? false),
        ndvi,
        ndviDate: hr?.reading_date ?? null,
        state: wr?.state ?? null,
        waterDate: wr?.reading_date ?? null,
        ha: f.area_hectares,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/** Centre of a polygon ring by bbox — good enough for a flyTo target. */
export function featureCenter(geometry: GeoJSON.Polygon): [number, number] {
  const [minLon, minLat, maxLon, maxLat] = bboxOf(geometry.coordinates[0] as [number, number][]);
  return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
}
