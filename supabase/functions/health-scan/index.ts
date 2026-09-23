// Weekly Sentinel-2 health scan: for every parcel with a drawn boundary, ask
// the Copernicus Statistical API for cloud-masked mean NDVI/NDMI per pass,
// store the clean ones, and raise alerts when a parcel degrades.
//
// Two kinds of caller are allowed:
//   1. pg_cron / curl with the shared secret in the x-cron-secret header
//   2. a signed-in admin or manager, via the normal Authorization bearer token
//      (this is what the "Refresh health" button on the Map page uses, so no
//      cron secret ever has to reach the browser)
//
// Required secrets:
//   CDSE_CLIENT_ID, CDSE_CLIENT_SECRET   Copernicus OAuth client (see docs/DEPLOYMENT.md)
//   CRON_SECRET                          shared secret for the cron caller
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (set automatically by Supabase)

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  BOOTSTRAP_DAYS,
  CDSE_STATS_URL,
  CDSE_TOKEN_URL,
  COMPARE_WINDOW_DAYS,
  addDays,
  buildStatisticsRequest,
  evaluateThresholds,
  healthMarker,
  isCleanPass,
  parseStatistics,
  type HealthReading,
  type PolygonGeo,
} from "./health-core.ts";

interface ParcelRow {
  id: string;
  farm_name: string;
  farmer_id: string | null;
  boundary_geojson: unknown;
}

// Supabase Edge Functions add no CORS headers of their own. The browser
// caller (the "Refresh health" button) sends Authorization, apikey and
// Content-Type cross-origin, which triggers a preflight — without this the
// preflight is rejected before authorize() ever runs.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const denied = await authorize(req, supabase);
  if (denied) return denied;

  const clientId = Deno.env.get("CDSE_CLIENT_ID");
  const clientSecret = Deno.env.get("CDSE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return json({ error: "Satellite health is not configured yet — CDSE_CLIENT_ID / CDSE_CLIENT_SECRET are not set." }, 500);
  }

  let token: string;
  try {
    token = await cdseToken(clientId, clientSecret);
  } catch (e) {
    return json({ error: `CDSE sign-in failed: ${msg(e)}` }, 502);
  }

  // Only parcels with a drawn boundary can be measured.
  const { data: farms, error: farmsError } = await supabase
    .from("farms")
    .select("id, farm_name, farmer_id, boundary_geojson")
    .not("boundary_geojson", "is", null);
  if (farmsError) return json({ error: farmsError.message }, 500);

  const parcels = ((farms ?? []) as ParcelRow[]).filter((f) => isPolygon(f.boundary_geojson));
  if (parcels.length === 0) {
    return json({ parcels: 0, readings: 0, newAlerts: 0, skipped: [] });
  }

  const today = new Date().toISOString().slice(0, 10);
  let readings = 0;
  let newAlerts = 0;
  const skipped: string[] = [];

  for (const parcel of parcels) {
    // Start the day after the newest stored reading; bootstrap 30 days back.
    const { data: lastRows, error: lastError } = await supabase
      .from("parcel_health")
      .select("reading_date")
      .eq("farm_id", parcel.id)
      .order("reading_date", { ascending: false })
      .limit(1);
    if (lastError) {
      skipped.push(`${parcel.farm_name}: ${lastError.message}`);
      continue;
    }
    const lastDate = lastRows?.[0]?.reading_date as string | undefined;
    const from = lastDate ? addDays(lastDate, 1) : addDays(today, -BOOTSTRAP_DAYS);
    if (from > today) continue; // already up to date

    let parsed: HealthReading[];
    try {
      const res = await fetch(CDSE_STATS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(
          buildStatisticsRequest(parcel.boundary_geojson as PolygonGeo, from, today),
        ),
      });
      const text = await res.text();
      if (!res.ok) {
        skipped.push(`${parcel.farm_name}: CDSE ${res.status} ${text.slice(0, 120)}`);
        continue;
      }
      parsed = parseStatistics(JSON.parse(text));
    } catch (e) {
      skipped.push(`${parcel.farm_name}: ${msg(e)}`);
      continue;
    }

    const clean = parsed.filter(isCleanPass);
    if (clean.length === 0) continue;

    const { error: insertError } = await supabase
      .from("parcel_health")
      .upsert(
        clean.map((r) => ({ farm_id: parcel.id, ...r })),
        { onConflict: "farm_id,reading_date", ignoreDuplicates: true },
      );
    if (insertError) {
      skipped.push(`${parcel.farm_name}: ${insertError.message}`);
      continue;
    }
    readings += clean.length;

    // Compare the newest pass against this parcel's own recent history.
    const latest = clean.reduce((a, b) => (a.reading_date > b.reading_date ? a : b));
    const { data: history, error: historyError } = await supabase
      .from("parcel_health")
      .select("reading_date, ndvi_mean, ndmi_mean, cloud_pct")
      .eq("farm_id", parcel.id)
      .gte("reading_date", addDays(latest.reading_date, -COMPARE_WINDOW_DAYS))
      .lt("reading_date", latest.reading_date);
    if (historyError) {
      skipped.push(`${parcel.farm_name}: ${historyError.message}`);
      continue;
    }

    const alerts = evaluateThresholds(
      parcel.id,
      parcel.farm_name,
      latest,
      (history ?? []) as HealthReading[],
    );
    if (alerts.length === 0) continue;

    // Same 14-day marker lookback as the burn watch.
    const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
    const { data: existing, error: existingError } = await supabase
      .from("alerts")
      .select("description")
      .eq("source", "satellite_api")
      .gte("created_at", since);
    if (existingError) {
      skipped.push(`${parcel.farm_name}: ${existingError.message}`);
      continue;
    }
    const seen = (existing ?? [])
      .map((a: { description: string | null }) => a.description ?? "")
      .join("\n");

    const fresh = alerts.filter(
      (a) => !seen.includes(healthMarker(parcel.id, latest.reading_date, a.alert_type)),
    );
    if (fresh.length === 0) continue;

    const { error: alertError } = await supabase.from("alerts").insert(
      fresh.map((a) => ({
        alert_type: a.alert_type,
        source: "satellite_api",
        status: "new",
        severity: a.severity,
        farm_id: parcel.id,
        farmer_id: parcel.farmer_id,
        detected_date: `${latest.reading_date}T00:00:00Z`,
        description: a.description,
        recommended_action: a.recommended_action,
      })),
    );
    if (alertError) {
      skipped.push(`${parcel.farm_name}: ${alertError.message}`);
      continue;
    }
    newAlerts += fresh.length;
  }

  return json({ parcels: parcels.length, readings, newAlerts, skipped });
});

/** Returns a Response when the caller is NOT allowed, null when they are. */
async function authorize(
  req: Request,
  supabase: ReturnType<typeof createClient>,
): Promise<Response | null> {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") === cronSecret) return null;

  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return json({ error: "unauthorized" }, 401);

  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data?.user) return json({ error: "unauthorized" }, 401);

  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id);
  const allowed = (roles ?? []).some(
    (r: { role: string }) => r.role === "admin" || r.role === "manager",
  );
  return allowed ? null : json({ error: "Only an admin or manager can refresh satellite health." }, 403);
}

async function cdseToken(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(CDSE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 160)}`);
  const token = (JSON.parse(text) as { access_token?: string }).access_token;
  if (!token) throw new Error("no access_token in response");
  return token;
}

function isPolygon(value: unknown): boolean {
  const p = value as { type?: string; coordinates?: unknown } | null;
  return !!p && p.type === "Polygon" && Array.isArray(p.coordinates);
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
