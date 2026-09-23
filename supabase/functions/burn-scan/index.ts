// Scheduled burn watch: fetch NASA FIRMS hotspots in the BRM zone, raise
// alerts, and push a Telegram message when something new shows up.
//
// Runs on a cron (see supabase/migrations/*_burn_scan_cron.sql) so a fire at
// 2am is caught while it burns, instead of waiting for someone to open the app.
//
// Required secrets:
//   FIRMS_MAP_KEY        NASA FIRMS map key (same one the app uses)
//   CRON_SECRET          shared secret; callers must send it as x-cron-secret
//   SUPABASE_URL         (set automatically by Supabase)
//   SUPABASE_SERVICE_ROLE_KEY (set automatically by Supabase)
// Optional secrets — without them the scan still runs, it just stays silent:
//   TELEGRAM_BOT_TOKEN   bot token from @BotFather
//   TELEGRAM_CHAT_ID     target group/chat id (supergroups start with -100)

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  BURN_ZONE,
  attachHotspot,
  dedupeHotspots,
  hotspotMarker,
  hotspotSeverity,
  hotspotTimestamp,
  inZone,
  parseFirmsCsv,
  zoneBbox,
  type Hotspot,
  type ParcelForMatch,
} from "./firms-core.ts";

const FIRMS_SOURCES = ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT"];
const LOOKBACK_DAYS = 2; // cron runs hourly; 2 days covers any missed run.
const CONFIDENCE_LABEL: Record<string, string> = { l: "low", n: "nominal", h: "high" };

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return json({ error: "unauthorized" }, 401);
  }

  const firmsKey = Deno.env.get("FIRMS_MAP_KEY");
  if (!firmsKey) return json({ error: "FIRMS_MAP_KEY is not set" }, 500);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1. Hotspots inside the estate zone.
  const bbox = zoneBbox(BURN_ZONE);
  const all: Hotspot[] = [];
  for (const source of FIRMS_SOURCES) {
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${firmsKey}/${source}/${bbox}/${LOOKBACK_DAYS}`;
    let res: Response;
    try {
      res = await fetch(url);
    } catch (e) {
      return json({ error: `FIRMS unreachable: ${e instanceof Error ? e.message : String(e)}` }, 502);
    }
    const text = await res.text();
    // FIRMS answers 200 with an "Invalid MAP_KEY." body on a bad key.
    if (!res.ok || text.startsWith("Invalid")) {
      return json({ error: `FIRMS error (${source}): ${text.slice(0, 120)}` }, 502);
    }
    all.push(...parseFirmsCsv(text));
  }
  const hotspots = dedupeHotspots(all).filter((h) => inZone(h, BURN_ZONE));

  if (hotspots.length === 0) {
    return json({ hotspots: 0, newAlerts: 0, notified: false });
  }

  // 2. Parcels with GPS, for attaching a fire to a farm.
  const { data: farms, error: farmsError } = await supabase
    .from("farms")
    .select("id, farm_name, latitude, longitude, farmer_id, boundary_geojson");
  if (farmsError) return json({ error: farmsError.message }, 500);
  const farmsWithGps = ((farms ?? []) as ParcelForMatch[]).filter(
    (f) => (f.latitude != null && f.longitude != null) || f.boundary_geojson,
  );

  // 3. Skip hotspots already alerted on (marker string in the description).
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  const { data: existing, error: existingError } = await supabase
    .from("alerts")
    .select("description")
    .eq("source", "satellite_api")
    .gte("created_at", since);
  if (existingError) return json({ error: existingError.message }, 500);
  const seen = (existing ?? []).map((a: { description: string | null }) => a.description ?? "").join("\n");

  const fresh = hotspots.filter((h) => !seen.includes(hotspotMarker(h)));
  if (fresh.length === 0) {
    return json({ hotspots: hotspots.length, newAlerts: 0, notified: false });
  }

  const inserts = fresh.map((h) => buildAlert(h, farmsWithGps));
  const { error: insertError } = await supabase.from("alerts").insert(inserts);
  if (insertError) return json({ error: insertError.message }, 500);

  // 4. Push to Telegram. A failure here must not lose the alerts already saved.
  let notified = false;
  let notifyError: string | undefined;
  try {
    notified = await notifyTelegram(fresh, farmsWithGps);
  } catch (e) {
    notifyError = e instanceof Error ? e.message : String(e);
  }

  return json({ hotspots: hotspots.length, newAlerts: inserts.length, notified, notifyError });
});

function buildAlert(h: Hotspot, farms: ParcelForMatch[]) {
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
      `Confidence: ${CONFIDENCE_LABEL[h.confidence] ?? h.confidence}, power: ${h.frp} MW, ` +
      `satellite: ${h.satellite}, at ${h.latitude.toFixed(4)}, ${h.longitude.toFixed(4)}. ${hotspotMarker(h)}`,
    recommended_action:
      "Verify on site — BRM no-burn policy. Contact the farmer if burning is confirmed.",
  };
}

async function notifyTelegram(fresh: Hotspot[], farms: ParcelForMatch[]): Promise<boolean> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return false;

  const lines = fresh.slice(0, 5).map((h) => {
    const { attached, nearest } = attachHotspot(h, farms);
    const where = attached
      ? attached.byPolygon
        ? `inside ${attached.farm.farm_name}`
        : `${Math.round(attached.km * 1000)} m from ${attached.farm.farm_name}`
      : nearest
        ? `nearest parcel ${nearest.farm.farm_name}, ${nearest.km.toFixed(1)} km`
        : "no parcel GPS on file yet";
    const time = `${h.acq_date} ${h.acq_time.slice(0, 2)}:${h.acq_time.slice(2, 4)} UTC`;
    const maps = `https://maps.google.com/?q=${h.latitude.toFixed(4)},${h.longitude.toFixed(4)}`;
    return `• ${where}\n  ${time}, ${h.frp} MW, confidence ${CONFIDENCE_LABEL[h.confidence] ?? h.confidence}\n  ${maps}`;
  });
  const more = fresh.length > lines.length ? `\n…and ${fresh.length - lines.length} more.` : "";

  const text =
    `🔥 BRM burn watch: ${fresh.length} new satellite fire detection(s) in the estate zone.\n\n` +
    `${lines.join("\n\n")}${more}\n\nCheck the app to verify and resolve.`;

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
