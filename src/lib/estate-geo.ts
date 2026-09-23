// Static estate geometry (estate survey, 07.04.24).
// Files live under public/geo and are fetched once per session.

export const ESTATE_CENTER = { latitude: 12.5591, longitude: 104.9147 } as const;

/** [minLon, minLat, maxLon, maxLat] of every surveyed polygon. */
export const ESTATE_BBOX: [number, number, number, number] = [104.8733, 12.5332, 104.941, 12.6182];

export type GeoLayer = "estate" | "blocks" | "canals" | "roads" | "own-plots";

const cache = new Map<GeoLayer, Promise<GeoJSON.FeatureCollection | null>>();

export function loadGeo(name: GeoLayer): Promise<GeoJSON.FeatureCollection | null> {
  let p = cache.get(name);
  if (!p) {
    p = fetch(`/geo/${name}.geojson`)
      .then((r) => (r.ok ? (r.json() as Promise<GeoJSON.FeatureCollection>) : null))
      .catch(() => null);
    cache.set(name, p);
  }
  return p;
}
