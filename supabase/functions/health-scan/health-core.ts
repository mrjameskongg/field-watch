// Pure helpers for Sentinel-2 parcel health. No I/O and no app imports, so the
// whole file can be unit-tested here and copied verbatim into the health-scan
// edge function (Deno cannot resolve the "@/" alias).

/** GeoJSON Polygon geometry, coordinates ordered [lng, lat]. Structurally the
 *  same as firms-core's PolygonGeo — declared again so this file stands alone. */
export interface PolygonGeo {
  type: "Polygon";
  coordinates: [number, number][][];
}

/** One clean satellite pass over one parcel. */
export interface HealthReading {
  reading_date: string; // YYYY-MM-DD, the acquisition day
  ndvi_mean: number;
  ndmi_mean: number;
  cloud_pct: number;
}

export const CDSE_TOKEN_URL =
  "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
export const CDSE_STATS_URL = "https://sh.dataspace.copernicus.eu/api/v1/statistics";

/** Passes cloudier than this inside the parcel are not stored at all. */
export const MAX_CLOUD_PCT = 40;
/** A pass is only worth storing when enough of the parcel was actually visible. */
export function isCleanPass(reading: HealthReading): boolean {
  return reading.cloud_pct <= MAX_CLOUD_PCT;
}
/** First scan of a parcel looks this far back. */
export const BOOTSTRAP_DAYS = 30;

/**
 * Cloud fraction cannot be read off noDataCount, because that also counts
 * pixels outside the request geometry. So the dataMask here is geometry-only
 * and cloudiness is carried in the numbers instead: over the parcel's pixels,
 * mean(clear) is the clear fraction, and mean(ndvi*clear)/mean(clear) is the
 * mean NDVI over clear pixels. SCL classes treated as unusable: 0 no data,
 * 1 saturated, 3 cloud shadow, 8 cloud medium, 9 cloud high, 10 thin cirrus.
 */
export const HEALTH_EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B08", "B11", "SCL", "dataMask"] }],
    output: [
      { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
      { id: "ndmi", bands: 1, sampleType: "FLOAT32" },
      { id: "clear", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ]
  };
}
function evaluatePixel(s) {
  var unusable = s.SCL === 0 || s.SCL === 1 || s.SCL === 3 || s.SCL === 8 || s.SCL === 9 || s.SCL === 10;
  var clear = unusable ? 0 : 1;
  var ndvi = (s.B08 + s.B04) === 0 ? 0 : (s.B08 - s.B04) / (s.B08 + s.B04);
  var ndmi = (s.B08 + s.B11) === 0 ? 0 : (s.B08 - s.B11) / (s.B08 + s.B11);
  return {
    ndvi: [ndvi * clear],
    ndmi: [ndmi * clear],
    clear: [clear],
    dataMask: [s.dataMask]
  };
}`;

/** Statistical API request for one parcel over an inclusive date range. */
export function buildStatisticsRequest(
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
      data: [{ type: "sentinel-2-l2a" }],
    },
    aggregation: {
      timeRange: { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` },
      aggregationInterval: { of: "P1D" },
      evalscript: HEALTH_EVALSCRIPT,
      resx: 10,
      resy: 10,
    },
    calculations: { default: {} },
  };
}

interface StatBand {
  stats?: { mean?: number; sampleCount?: number; noDataCount?: number };
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
 * Statistical API response -> one reading per usable day. Days the API errored
 * on, days with no acquisition, and fully clouded days are dropped.
 */
export function parseStatistics(json: unknown): HealthReading[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];

  const out: HealthReading[] = [];
  for (const entry of data as StatEntry[]) {
    if (!entry || entry.error) continue;
    const date = entry.interval?.from?.slice(0, 10);
    if (!date) continue;
    const clear = meanOf(entry, "clear");
    const ndvi = meanOf(entry, "ndvi");
    const ndmi = meanOf(entry, "ndmi");
    if (clear === null || ndvi === null || ndmi === null) continue;
    if (clear <= 0) continue; // nothing visible through the cloud
    out.push({
      reading_date: date,
      ndvi_mean: round(ndvi / clear, 4),
      ndmi_mean: round(ndmi / clear, 4),
      cloud_pct: round((1 - clear) * 100, 2),
    });
  }
  return out;
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

/** A reading with its parcel, as read back from the parcel_health table. */
export interface HealthRow extends HealthReading {
  farm_id: string;
}

export interface HealthAlert {
  alert_type: "low_vegetation" | "water_stress";
  severity: "medium" | "high";
  description: string;
  recommended_action: string;
}

/** Readings further apart than this are never compared to each other. */
export const COMPARE_WINDOW_DAYS = 30;

/** Dedupe marker embedded in the alert description, same idea as FIRMS markers. */
export function healthMarker(farmId: string, readingDate: string, type: string): string {
  return `[S2 ${farmId} ${readingDate} ${type}]`;
}

/**
 * Thresholds from the approved spec:
 *  - low_vegetation when the latest NDVI is under 80% of the parcel's own mean
 *    over the previous 30 days AND under 0.5 in absolute terms (so a healthy
 *    but variable field is never flagged). High severity at a 35%+ drop.
 *  - water_stress when NDMI is under 0.15; high under 0.05. No baseline needed.
 */
export function evaluateThresholds(
  farmId: string,
  farmName: string,
  latest: HealthReading,
  previous: HealthReading[],
): HealthAlert[] {
  const alerts: HealthAlert[] = [];

  const recent = previous.filter(
    (r) =>
      r.reading_date !== latest.reading_date &&
      daysBetween(r.reading_date, latest.reading_date) <= COMPARE_WINDOW_DAYS &&
      daysBetween(r.reading_date, latest.reading_date) > 0,
  );

  if (recent.length > 0) {
    const baseline = recent.reduce((s, r) => s + r.ndvi_mean, 0) / recent.length;
    if (baseline > 0 && latest.ndvi_mean < 0.8 * baseline && latest.ndvi_mean < 0.5) {
      const dropPct = Math.round((1 - latest.ndvi_mean / baseline) * 100);
      alerts.push({
        alert_type: "low_vegetation",
        severity: dropPct >= 35 ? "high" : "medium",
        description:
          `Vegetation on ${farmName} is down ${dropPct}% against its own last ${COMPARE_WINDOW_DAYS} days ` +
          `(NDVI ${latest.ndvi_mean.toFixed(2)} vs ${baseline.toFixed(2)}), from the ${latest.reading_date} ` +
          `satellite pass. ${healthMarker(farmId, latest.reading_date, "low_vegetation")}`,
        recommended_action:
          "Visit the parcel — check for pests, disease, flooding or an early harvest before treating it as a problem.",
      });
    }
  }

  if (latest.ndmi_mean < 0.15) {
    alerts.push({
      alert_type: "water_stress",
      severity: latest.ndmi_mean < 0.05 ? "high" : "medium",
      description:
        `${farmName} looks dry from space (NDMI ${latest.ndmi_mean.toFixed(2)}) on the ` +
        `${latest.reading_date} satellite pass. ${healthMarker(farmId, latest.reading_date, "water_stress")}`,
      recommended_action: "Check irrigation and recent rainfall for this parcel.",
    });
  }

  return alerts;
}

export function vegetationLabel(ndvi: number): "healthy" | "moderate" | "poor" {
  if (ndvi >= 0.6) return "healthy";
  if (ndvi >= 0.4) return "moderate";
  return "poor";
}

export function waterLabel(ndmi: number): "adequate" | "low" | "stressed" {
  if (ndmi >= 0.15) return "adequate";
  if (ndmi >= 0.05) return "low";
  return "stressed";
}

/** Map polygon fill: green healthy, yellow moderate, red poor, grey unknown. */
export function healthColor(ndvi: number | null | undefined): string {
  if (ndvi === null || ndvi === undefined || !Number.isFinite(ndvi)) return "#94a3b8";
  if (ndvi >= 0.6) return "#16a34a";
  if (ndvi >= 0.4) return "#eab308";
  return "#dc2626";
}

/** Yellow or red — what the dashboard counts. */
export function isStressed(ndvi: number): boolean {
  return ndvi < 0.6;
}

/** Newest reading per parcel, from rows in any order. */
export function latestByFarm(rows: HealthRow[]): Map<string, HealthRow> {
  const latest = new Map<string, HealthRow>();
  for (const row of rows) {
    const held = latest.get(row.farm_id);
    if (!held || row.reading_date > held.reading_date) latest.set(row.farm_id, row);
  }
  return latest;
}

/** Parcels whose newest reading is yellow or red. */
export function stressedCount(rows: HealthRow[]): number {
  let n = 0;
  for (const row of latestByFarm(rows).values()) if (isStressed(row.ndvi_mean)) n++;
  return n;
}
