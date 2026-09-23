import { supabase } from "@/integrations/supabase/client";
import { fetchHotspots } from "./firms";
import {
  attachHotspot,
  hotspotMarker,
  hotspotSeverity,
  hotspotTimestamp,
  type Hotspot,
  type ParcelForMatch,
} from "./firms-core";
import type { Database } from "@/integrations/supabase/types";

type AlertInsert = Database["public"]["Tables"]["alerts"]["Insert"];

export interface ScanResult {
  hotspots: number;
  newAlerts: number;
  farmsWithoutGps: number;
  error?: string;
}

const CONFIDENCE_LABEL: Record<string, string> = { l: "low", n: "nominal", h: "high" };

/**
 * Fetch FIRMS hotspots in the BRM zone and create possible_burn alerts.
 * Idempotent: re-running never duplicates alerts (marker string dedupe).
 */
export async function runBurnScan(): Promise<ScanResult> {
  const { hotspots, error } = await fetchHotspots({ data: { days: 3 } });
  if (error) return { hotspots: 0, newAlerts: 0, farmsWithoutGps: 0, error };

  const { data: farms, error: farmsError } = await supabase
    .from("farms")
    .select("id, farm_name, latitude, longitude, farmer_id, boundary_geojson");
  if (farmsError) return { hotspots: hotspots.length, newAlerts: 0, farmsWithoutGps: 0, error: farmsError.message };

  const farmsWithGps = (farms || []).filter(
    (f) => (f.latitude != null && f.longitude != null) || f.boundary_geojson,
  );
  const farmsWithoutGps = (farms || []).length - farmsWithGps.length;
  if (hotspots.length === 0) return { hotspots: 0, newAlerts: 0, farmsWithoutGps };

  // Existing satellite alerts from the last 14 days, for dedupe.
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  const { data: existing, error: existingError } = await supabase
    .from("alerts")
    .select("description")
    .eq("source", "satellite_api")
    .gte("created_at", since);
  if (existingError) return { hotspots: hotspots.length, newAlerts: 0, farmsWithoutGps, error: existingError.message };
  const seen = (existing || []).map((a) => a.description || "").join("\n");

  const inserts: AlertInsert[] = [];
  for (const h of hotspots) {
    const marker = hotspotMarker(h);
    if (seen.includes(marker)) continue;
    inserts.push(buildAlert(h, marker, farmsWithGps));
  }

  if (inserts.length > 0) {
    const { error: insertError } = await supabase.from("alerts").insert(inserts);
    if (insertError) return { hotspots: hotspots.length, newAlerts: 0, farmsWithoutGps, error: insertError.message };
  }

  return { hotspots: hotspots.length, newAlerts: inserts.length, farmsWithoutGps };
}

function buildAlert(h: Hotspot, marker: string, farms: ParcelForMatch[]): AlertInsert {
  const { attached, nearest } = attachHotspot(h, farms);

  const where = attached
    ? attached.byPolygon
      ? `inside ${attached.farm.farm_name}`
      : `${Math.round(attached.km * 1000)} m from ${attached.farm.farm_name}`
    : nearest
      ? `inside BRM estate zone, nearest parcel ${nearest.farm.farm_name} (${nearest.km.toFixed(1)} km)`
      : "inside BRM estate zone (no parcels have GPS yet)";

  return {
    alert_type: "possible_burn",
    source: "satellite_api",
    status: "new",
    severity: hotspotSeverity(h),
    farm_id: attached ? attached.farm.id : null,
    farmer_id: attached ? attached.farm.farmer_id : null,
    detected_date: hotspotTimestamp(h),
    description:
      `Satellite fire detection ${where}. ` +
      `Confidence: ${CONFIDENCE_LABEL[h.confidence] || h.confidence}, power: ${h.frp} MW, ` +
      `satellite: ${h.satellite}, at ${h.latitude.toFixed(4)}, ${h.longitude.toFixed(4)}. ${marker}`,
    recommended_action: "Verify on site — BRM no-burn policy. Contact the farmer if burning is confirmed.",
  };
}

const AUTO_SCAN_KEY = "lastBurnScan";
const AUTO_SCAN_INTERVAL_MS = 20 * 3600 * 1000;

/** Run a scan at most once per 20 h, triggered when someone opens the app. */
export async function maybeAutoScan(): Promise<ScanResult | null> {
  if (typeof window === "undefined") return null;
  const last = Number(localStorage.getItem(AUTO_SCAN_KEY) || 0);
  if (Date.now() - last < AUTO_SCAN_INTERVAL_MS) return null;
  localStorage.setItem(AUTO_SCAN_KEY, String(Date.now()));
  return runBurnScan();
}
