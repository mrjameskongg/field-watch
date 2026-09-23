// Pure helpers for Sentinel-1 SAR flooded/drained detection. No I/O and no app
// imports, so this file is unit-tested here and copied verbatim into the
// water-scan edge function (Deno cannot resolve the "@/" alias).
//
// Why radar: water is a specular reflector, so a flooded field bounces the
// radar pulse away from the satellite and reads very dark. A drained field
// scatters more back. Radar also sees through cloud, which is the whole point
// during the Cambodian wet season when Sentinel-2 is blind for weeks.
//
// This is deliberately a threshold, not a model. A wrong AWD record is worse
// than no record, so the classifier is allowed to answer "uncertain" and the
// raw decibel values are stored so thresholds can be retuned later without
// re-fetching a single scene.

/** GeoJSON Polygon geometry, coordinates ordered [lng, lat]. */
export interface PolygonGeo {
  type: "Polygon";
  coordinates: [number, number][][];
}

/** One Sentinel-1 pass over one parcel, already averaged inside the boundary. */
export interface WaterReading {
  reading_date: string; // YYYY-MM-DD, the acquisition day
  vv_db: number; // mean VV backscatter, decibels
  vh_db: number; // mean VH backscatter, decibels
}

export const CDSE_TOKEN_URL =
  "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
export const CDSE_STATS_URL = "https://sh.dataspace.copernicus.eu/api/v1/statistics";

/** First scan of a parcel looks this far back. Sentinel-1 revisit is ~12 days
 *  per satellite, so 30 days guarantees at least two passes. */
export const BOOTSTRAP_DAYS = 30;

/**
 * Sentinel-1 GRD, gamma0 (the API default), with Lee speckle filtering applied
 * server-side. Values arrive as linear power; averaging happens in the linear
 * domain and the conversion to decibels is done after, which is the correct
 * order for backscatter.
 */
export const WATER_EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["VV", "VH", "dataMask"] }],
    output: [
      { id: "vv", bands: 1, sampleType: "FLOAT32" },
      { id: "vh", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ]
  };
}
function evaluatePixel(s) {
  return {
    vv: [s.VV],
    vh: [s.VH],
    dataMask: [s.dataMask]
  };
}`;

/** Statistical API request for one parcel over an inclusive date range. */
export function buildWaterRequest(
  polygon: PolygonGeo,
  from: string,
  to: string,
): Record<string, unknown> {
  return {
    input: {
      bounds: {
        geometry: polygon,
        properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" },
      },
      data: [
        {
          type: "sentinel-1-grd",
          processing: {
            // Terrain-flattened gamma0 would need orthorectification and a DEM
            // lookup per request; the ellipsoid variant is enough for the flat
            // paddy land this runs over, and it is far cheaper.
            backCoeff: "GAMMA0_ELLIPSOID",
            orthorectify: true,
            speckleFilter: { type: "LEE", windowSizeX: 5, windowSizeY: 5 },
          },
        },
      ],
    },
    aggregation: {
      timeRange: { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` },
      aggregationInterval: { of: "P1D" },
      evalscript: WATER_EVALSCRIPT,
      resx: 10,
      resy: 10,
    },
    calculations: { default: {} },
  };
}

/** Linear power to decibels. Guards the log at zero. */
export function toDecibels(linear: number): number {
  if (!(linear > 0)) return -40; // floor: darker than any real land or water
  return 10 * Math.log10(linear);
}

interface StatBand {
  stats?: { mean?: number };
}
interface StatEntry {
  interval?: { from?: string };
  outputs?: Record<string, { bands?: Record<string, StatBand> }>;
  error?: unknown;
}

function meanOf(entry: StatEntry, outputId: string): number | null {
  const mean = entry.outputs?.[outputId]?.bands?.B0?.stats?.mean;
  return typeof mean === "number" && Number.isFinite(mean) ? mean : null;
}

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * Statistical API response -> one reading per pass. Days the API errored on and
 * days with no acquisition are dropped. Unlike the optical scan there is no
 * cloud filter, because there is no cloud to filter.
 */
export function parseWaterStatistics(json: unknown): WaterReading[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];

  const out: WaterReading[] = [];
  for (const entry of data as StatEntry[]) {
    if (!entry || entry.error) continue;
    const date = entry.interval?.from?.slice(0, 10);
    if (!date) continue;
    const vv = meanOf(entry, "vv");
    const vh = meanOf(entry, "vh");
    if (vv === null || vh === null) continue;
    out.push({
      reading_date: date,
      vv_db: round(toDecibels(vv), 2),
      vh_db: round(toDecibels(vh), 2),
    });
  }
  return out;
}

export type WaterState = "flooded" | "drained" | "uncertain";

/**
 * VV decibel thresholds. Standing water on a bare or early-growth paddy reads
 * around -18 dB and below; a drained field reads around -10 dB and above. The
 * gap between them is reported as uncertain rather than guessed.
 */
export const FLOODED_VV_DB = -15;
export const DRAINED_VV_DB = -10;

/**
 * Once the canopy closes, the rice plants scatter the signal themselves and a
 * flooded field stops looking dark, so late-season "drained" readings are not
 * trustworthy. VH rising above this marks a developed canopy.
 */
export const CANOPY_VH_DB = -18;

export interface WaterVerdict {
  state: WaterState;
  /** False once the canopy is developed enough to mask standing water. */
  confident: boolean;
  reason: string;
}

export function classifyWater(reading: WaterReading): WaterVerdict {
  const canopy = reading.vh_db > CANOPY_VH_DB;

  if (reading.vv_db <= FLOODED_VV_DB) {
    return {
      state: "flooded",
      // A dark VV under a closed canopy is still water: vegetation only ever
      // raises backscatter, so a low reading cannot be a canopy artefact.
      confident: true,
      reason: `VV ${reading.vv_db} dB — surface water present`,
    };
  }
  if (reading.vv_db >= DRAINED_VV_DB) {
    return {
      state: "drained",
      confident: !canopy,
      reason: canopy
        ? `VV ${reading.vv_db} dB, but VH ${reading.vh_db} dB indicates a developed canopy that can hide standing water`
        : `VV ${reading.vv_db} dB — no standing water detected`,
    };
  }
  return {
    state: "uncertain",
    confident: false,
    reason: `VV ${reading.vv_db} dB falls between the flooded and drained thresholds`,
  };
}

/** A reading with its parcel, as read back from the parcel_water table. */
export interface WaterRow extends WaterReading {
  farm_id: string;
  state: WaterState;
}

/* ------------------------------------------------------------------ */
/* Cross-check against what the field officer logged                   */
/* ------------------------------------------------------------------ */

export type Agreement = "agrees" | "disagrees" | "unconfirmed" | "inconclusive";

export interface CrossCheck {
  agreement: Agreement;
  satellite: WaterState;
  logged: "flooded" | "drained" | null;
  /** Days between the satellite pass and the logged event. */
  gapDays: number | null;
  summary: string;
}

/** A logged water event, as stored in field_events. */
export interface LoggedWaterEvent {
  event_date: string;
  water_state: string | null;
}

/** Beyond this many days a logged event and a satellite pass describe
 *  different moments, and comparing them proves nothing. */
export const CROSS_CHECK_WINDOW_DAYS = 6;

/**
 * Compare one satellite pass with the nearest logged water event. This is the
 * output an MRV auditor actually wants: two independent records of the same
 * fact, and an explicit note when they do not match.
 */
export function crossCheck(
  reading: WaterReading,
  verdict: WaterVerdict,
  events: LoggedWaterEvent[],
): CrossCheck {
  const candidates = events
    .filter((e) => e.water_state === "flooded" || e.water_state === "drained")
    .map((e) => ({ ...e, gap: Math.abs(daysBetween(e.event_date, reading.reading_date)) }))
    .filter((e) => e.gap <= CROSS_CHECK_WINDOW_DAYS)
    .sort((a, b) => a.gap - b.gap);

  const nearest = candidates[0] ?? null;

  if (verdict.state === "uncertain") {
    return {
      agreement: "inconclusive",
      satellite: verdict.state,
      logged: (nearest?.water_state as "flooded" | "drained") ?? null,
      gapDays: nearest?.gap ?? null,
      summary: "Satellite reading was not decisive.",
    };
  }

  if (!nearest) {
    return {
      agreement: "unconfirmed",
      satellite: verdict.state,
      logged: null,
      gapDays: null,
      summary: `Satellite saw the field ${verdict.state}; nothing was logged within ${CROSS_CHECK_WINDOW_DAYS} days.`,
    };
  }

  const logged = nearest.water_state as "flooded" | "drained";
  const agrees = logged === verdict.state;
  return {
    agreement: agrees ? "agrees" : "disagrees",
    satellite: verdict.state,
    logged,
    gapDays: nearest.gap,
    summary: agrees
      ? `Field officer logged ${logged}; satellite agrees (${nearest.gap} day gap).`
      : `Field officer logged ${logged}; satellite saw ${verdict.state} (${nearest.gap} day gap).`,
  };
}

/** Share of decisive comparisons that agreed, over a season. Null when there is
 *  nothing decisive to score — an empty ledger must not read as 100%. */
export function agreementRate(checks: CrossCheck[]): number | null {
  const decisive = checks.filter((c) => c.agreement === "agrees" || c.agreement === "disagrees");
  if (decisive.length === 0) return null;
  const agreed = decisive.filter((c) => c.agreement === "agrees").length;
  return Math.round((agreed / decisive.length) * 100);
}

/** Count of distinct dry spells the satellite itself observed. */
export function satelliteDrySpells(rows: Pick<WaterRow, "state">[]): number {
  let spells = 0;
  let inSpell = false;
  for (const r of rows) {
    if (r.state === "drained") {
      if (!inSpell) spells++;
      inSpell = true;
    } else if (r.state === "flooded") {
      inSpell = false;
    }
    // "uncertain" neither starts nor ends a spell
  }
  return spells;
}

/** Dedupe marker embedded in alert descriptions, same idea as the S2 markers. */
export function waterMarker(farmId: string, readingDate: string): string {
  return `[S1 ${farmId} ${readingDate}]`;
}

/** YYYY-MM-DD shifted by whole days, UTC, no Date-parsing surprises. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b; negative when b is earlier than a. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

/* ------------------------------------------------------------------ */
/* Per-reading confidence and rainfall context                         */
/* ------------------------------------------------------------------ */

/**
 * How far a reading sits from the decision boundary, expressed as a score a
 * non-expert can read. 3 dB clear of the threshold is treated as a full-margin
 * call: Sentinel-1 GRD radiometric accuracy is roughly ±1 dB, so three times
 * that is comfortably outside instrument noise. A decisive state read under a
 * closed canopy is capped low regardless of margin, because the physics says
 * the canopy — not the water — may be producing the signal.
 */
export const FULL_MARGIN_DB = 3;

export interface Confidence {
  /** 0.05–1.00, margin-based. Stored nowhere; recomputed from raw decibels. */
  score: number;
  grade: "high" | "medium" | "low";
}

export function confidenceScore(reading: WaterReading): Confidence {
  const verdict = classifyWater(reading);
  let score: number;
  if (verdict.state === "uncertain") {
    score = 0.2;
  } else {
    const margin =
      verdict.state === "flooded"
        ? FLOODED_VV_DB - reading.vv_db
        : reading.vv_db - DRAINED_VV_DB;
    score = Math.min(1, margin / FULL_MARGIN_DB);
    if (!verdict.confident) score = Math.min(score, 0.3);
  }
  score = Math.max(0.05, Math.round(score * 100) / 100);
  const grade = score >= 0.67 ? "high" : score >= 0.34 ? "medium" : "low";
  return { score, grade };
}

/**
 * Rainfall context for one radar pass. AWD monitoring must separate managed
 * water events from weather: a drained field after 72 rain-free hours is a
 * farmer's decision; a flooded field right after a downpour proves nothing
 * about irrigation practice. Rain data is an annotation, never an input to
 * the flooded/drained call itself — the radar verdict stands on its own.
 */
export const RAIN_DRY_MM = 5; // ≤ this over the prior 72 h: drying was managed
export const RAIN_WET_MM = 20; // ≥ this: flooding may simply be rainfall

export type RainLabel = "managed_dry" | "rain_possible" | "neutral" | "no_data";

export interface RainContext {
  label: RainLabel;
  /** Total precipitation over the pass day and the two days before, mm. */
  rain72h: number | null;
}

export function rainContext(
  readingDate: string,
  state: WaterState,
  rainByDate: Record<string, number>,
): RainContext {
  let sum = 0;
  let seen = 0;
  for (let i = 0; i <= 2; i++) {
    const mm = rainByDate[addDays(readingDate, -i)];
    if (typeof mm === "number" && Number.isFinite(mm)) {
      sum += mm;
      seen++;
    }
  }
  if (seen === 0) return { label: "no_data", rain72h: null };
  const rain72h = Math.round(sum * 10) / 10;
  // A decisive label requires the whole 72 h window in the record: a single
  // covered day at 0 mm must not become "no significant rain in 72 h".
  if (seen < 3) return { label: "neutral", rain72h };
  if (state === "drained" && rain72h <= RAIN_DRY_MM) return { label: "managed_dry", rain72h };
  if (state === "flooded" && rain72h >= RAIN_WET_MM) return { label: "rain_possible", rain72h };
  return { label: "neutral", rain72h };
}
