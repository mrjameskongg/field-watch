// When was the satellite photo under the map actually taken?
//
// The Esri World Imagery basemap is a mosaic: different parts of one estate can
// come from captures months or years apart, and over Kampong Thom every capture
// so far is a dry-season one — so the ground never looks like it does in the
// wet season, whatever date the health slider says. Esri publishes the capture
// footprints as queryable layers on the same service, so we sample a handful of
// points and print the honest range next to the legend.
//
// Layer 11 is the 1.2 m resolution metadata layer; it is the coarsest one that
// still resolves the 0.3 m Vivid tiles used here, and unlike layers 9-10 it
// returns a footprint at every point we sample.

import { ESTATE_BBOX, ESTATE_CENTER } from "./estate-geo";

const METADATA_URL =
  "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/11/query";

const CACHE_KEY = "fw.imagery-date.v1";
const CACHE_DAYS = 30;

export type ImageryCapture = { date: string; resM: number | null; source: string | null };

export type ImagerySummary = {
  /** Earliest capture found under the estate, YYYY-MM. */
  from: string;
  /** Latest capture found, YYYY-MM. Equal to `from` when the mosaic is one pass. */
  to: string;
  resM: number | null;
  source: string | null;
  /** True when every sampled capture falls in the Cambodian dry season. */
  allDrySeason: boolean;
};

/** Nov-Apr in Cambodia: fields are bare or stubble, never the green of the wet crop. */
export function isDrySeasonMonth(month: number): boolean {
  return month >= 11 || month <= 4;
}

/** Pure: fold the sampled captures into one honest line. Null when nothing resolved. */
export function summariseImagery(captures: ImageryCapture[]): ImagerySummary | null {
  const dated = captures.filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.date)).sort((a, b) => a.date.localeCompare(b.date));
  if (dated.length === 0) return null;
  const first = dated[0];
  const last = dated[dated.length - 1];
  // Resolution and provider: report the sharpest, which is what the eye sees.
  const best = dated.reduce((a, b) => ((b.resM ?? Infinity) < (a.resM ?? Infinity) ? b : a));
  return {
    from: first.date.slice(0, 7),
    to: last.date.slice(0, 7),
    resM: best.resM,
    source: best.source,
    allDrySeason: dated.every((c) => isDrySeasonMonth(Number(c.date.slice(5, 7)))),
  };
}

/** Pure: the one-line label. `dry` is the caller's translated "dry season" wording. */
export function imageryLabel(s: ImagerySummary, prefix: string, dry: string): string {
  const when = s.from === s.to ? s.from : `${s.from} – ${s.to}`;
  const bits = [when];
  if (s.source) bits.push(s.resM ? `${s.source} ${s.resM.toFixed(1)} m` : s.source);
  if (s.allDrySeason) bits.push(dry);
  return `${prefix} ${bits.join(" · ")}`;
}

/** Estate corners plus the centre — enough to catch a seam without hammering Esri. */
function samplePoints(): [number, number][] {
  const [minLon, minLat, maxLon, maxLat] = ESTATE_BBOX;
  return [
    [ESTATE_CENTER.longitude, ESTATE_CENTER.latitude],
    [minLon, minLat],
    [minLon, maxLat],
    [maxLon, minLat],
    [maxLon, maxLat],
  ];
}

async function captureAt(lon: number, lat: number): Promise<ImageryCapture | null> {
  const url =
    `${METADATA_URL}?geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326` +
    `&spatialRel=esriSpatialRelIntersects&outFields=SRC_DATE2,SRC_RES,NICE_NAME&returnGeometry=false&f=json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const body = (await res.json()) as {
    features?: { attributes?: { SRC_DATE2?: number; SRC_RES?: number; NICE_NAME?: string } }[];
  };
  const a = body.features?.[0]?.attributes;
  if (!a?.SRC_DATE2) return null;
  return {
    date: new Date(a.SRC_DATE2).toISOString().slice(0, 10),
    resM: typeof a.SRC_RES === "number" ? a.SRC_RES : null,
    source: a.NICE_NAME ?? null,
  };
}

let inflight: Promise<ImagerySummary | null> | null = null;

/**
 * Capture dates under the estate. Cached in localStorage for a month — Esri
 * refreshes this mosaic a couple of times a year, and a stale month costs
 * nothing next to five cross-origin round trips on every map open.
 *
 * Deliberately takes no AbortSignal: the promise is shared between callers, so
 * one component unmounting would cancel the fetch for every other one. Callers
 * drop the result instead. Five cached GETs are not worth cancelling.
 */
export function estateImageryDate(): Promise<ImagerySummary | null> {
  if (inflight) return inflight;

  const cached = readCache();
  if (cached) return Promise.resolve(cached);

  inflight = (async () => {
    try {
      const results = await Promise.all(
        samplePoints().map(([lon, lat]) => captureAt(lon, lat).catch(() => null)),
      );
      const summary = summariseImagery(results.filter((r): r is ImageryCapture => r !== null));
      if (summary) writeCache(summary);
      return summary;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

function readCache(): ImagerySummary | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { at, summary } = JSON.parse(raw) as { at: number; summary: ImagerySummary };
    if (Date.now() - at > CACHE_DAYS * 86_400_000) return null;
    return summary;
  } catch {
    return null;
  }
}

function writeCache(summary: ImagerySummary) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), summary }));
  } catch {
    // Private mode / quota — the label just refetches next time.
  }
}
