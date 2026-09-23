// Sentinel-1 SAR water scan: for every parcel with a drawn boundary, ask the
// Copernicus Statistical API for mean VV/VH backscatter per radar pass, decide
// flooded / drained / uncertain, and store it.
//
// Why this exists separately from health-scan: radar sees through cloud. During
// the Cambodian wet season the optical scan produces nothing for weeks at a
// time, which is exactly when the water management being recorded matters most.
//
// The stored verdict is an independent second record of what the field officer
// logged. Two sources agreeing is what an MRV audit wants; two sources
// disagreeing is a thing worth knowing before an auditor finds it.
//
// Two kinds of caller are allowed, same as health-scan:
//   1. pg_cron / curl with the shared secret in the x-cron-secret header
//   2. a signed-in admin or manager, via the normal Authorization bearer token
//
// Required secrets:
//   CDSE_CLIENT_ID, CDSE_CLIENT_SECRET   Copernicus OAuth client (shared with health-scan)
//   CRON_SECRET                          shared secret for the cron caller
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID optional — over-pumping watch messages (no-op without them)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (set automatically by Supabase)

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  BOOTSTRAP_DAYS,
  CDSE_STATS_URL,
  CDSE_TOKEN_URL,
  addDays,
  buildWaterRequest,
  classifyWater,
  parseWaterStatistics,
  type PolygonGeo,
  type WaterReading,
} from "./water-core.ts";
import { DEFAULT_PUMPING_RULE, floodStreak, pumpFlag } from "./pumping-core.ts";

interface ParcelRow {
  id: string;
  farm_name: string;
  boundary_geojson: unknown;
}

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
    return json({ error: "Radar water scan is not configured yet — CDSE_CLIENT_ID / CDSE_CLIENT_SECRET are not set." }, 500);
  }

  let token: string;
  try {
    token = await cdseToken(clientId, clientSecret);
  } catch (e) {
    return json({ error: `CDSE sign-in failed: ${msg(e)}` }, 502);
  }

  const { data: farms, error: farmsError } = await supabase
    .from("farms")
    .select("id, farm_name, boundary_geojson")
    .not("boundary_geojson", "is", null);
  if (farmsError) return json({ error: farmsError.message }, 500);

  const parcels = ((farms ?? []) as ParcelRow[]).filter((f) => isPolygon(f.boundary_geojson));
  if (parcels.length === 0) {
    return json({ parcels: 0, readings: 0, flooded: 0, drained: 0, uncertain: 0, skipped: [] });
  }

  const today = new Date().toISOString().slice(0, 10);
  let readings = 0;
  let flooded = 0;
  let drained = 0;
  let uncertain = 0;
  const skipped: string[] = [];

  for (const parcel of parcels) {
    // Start the day after the newest stored reading; bootstrap 30 days back.
    const { data: lastRows, error: lastError } = await supabase
      .from("parcel_water")
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

    let parsed: WaterReading[];
    try {
      const res = await fetch(CDSE_STATS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(
          buildWaterRequest(parcel.boundary_geojson as PolygonGeo, from, today),
        ),
      });
      const text = await res.text();
      if (!res.ok) {
        skipped.push(`${parcel.farm_name}: CDSE ${res.status} ${text.slice(0, 120)}`);
        continue;
      }
      parsed = parseWaterStatistics(JSON.parse(text));
    } catch (e) {
      skipped.push(`${parcel.farm_name}: ${msg(e)}`);
      continue;
    }

    if (parsed.length === 0) continue;

    const rows = parsed.map((r) => {
      const verdict = classifyWater(r);
      if (verdict.state === "flooded") flooded++;
      else if (verdict.state === "drained") drained++;
      else uncertain++;
      return {
        farm_id: parcel.id,
        reading_date: r.reading_date,
        vv_db: r.vv_db,
        vh_db: r.vh_db,
        state: verdict.state,
        confident: verdict.confident,
      };
    });

    const { error: insertError } = await supabase
      .from("parcel_water")
      .upsert(rows, { onConflict: "farm_id,reading_date", ignoreDuplicates: true });
    if (insertError) {
      skipped.push(`${parcel.farm_name}: ${insertError.message}`);
      continue;
    }
    readings += rows.length;
  }

  // Over-pumping watch: same reduction as the /water page, run server-side so a
  // parcel that has been flooded past the rule with no drying signal reaches
  // the ops Telegram chat without anyone opening the app. Only parcels whose
  // newest pass landed in THIS run are reported, so a stuck parcel is named
  // once per new evidence, not on every scan.
  let notified = false;
  let notifyError: string | undefined;
  if (readings > 0) {
    try {
      notified = await notifyOverPumped(supabase, parcels, today);
    } catch (e) {
      notifyError = msg(e);
    }
  }

  return json({ parcels: parcels.length, readings, flooded, drained, uncertain, skipped, notified, notifyError });
});

async function notifyOverPumped(
  supabase: ReturnType<typeof createClient>,
  parcels: ParcelRow[],
  today: string,
): Promise<boolean> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return false;

  const since = addDays(today, -45);
  const ids = parcels.map((p) => p.id);
  const [{ data: passes }, { data: logs }] = await Promise.all([
    supabase.from("parcel_water").select("farm_id, reading_date, state, confident").in("farm_id", ids).gte("reading_date", since),
    supabase.from("field_events").select("farm_id, event_date, event_type, water_state").in("farm_id", ids).eq("event_type", "water").gte("event_date", since),
  ]);
  type Pass = { farm_id: string; reading_date: string; state: string; confident: boolean };
  type Log = { farm_id: string; event_date: string; event_type: string; water_state: string | null };
  const byFarm = new Map<string, Pass[]>();
  for (const p of (passes ?? []) as Pass[]) byFarm.set(p.farm_id, [...(byFarm.get(p.farm_id) ?? []), p]);
  const logsByFarm = new Map<string, Log[]>();
  for (const l of (logs ?? []) as Log[]) logsByFarm.set(l.farm_id, [...(logsByFarm.get(l.farm_id) ?? []), l]);

  const lines: string[] = [];
  for (const parcel of parcels) {
    const rows = byFarm.get(parcel.id) ?? [];
    if (rows.length === 0) continue;
    const streak = floodStreak(rows, logsByFarm.get(parcel.id) ?? []);
    // Report only when the newest evidence is from today's run.
    if (streak.latestPass !== today && !rows.some((r) => r.reading_date === today)) continue;
    const flag = pumpFlag(
      { latestPass: streak.latestPass, today, daysFlooded: streak.daysFlooded, neverDrained: streak.neverDrained },
      DEFAULT_PUMPING_RULE,
    );
    if (flag !== "never-dried" && flag !== "watch") continue;
    lines.push(
      `• ${parcel.farm_name}: ${flag === "never-dried" ? "flooded on every pass" : "flooded"} for ${streak.daysFlooded} d` +
        (streak.lastDrainedDate ? ` (last dry ${streak.lastDrainedDate})` : ", no drying seen"),
    );
  }
  if (lines.length === 0) return false;

  const text =
    `💧 BRM water watch: ${lines.length} parcel(s) past the ${DEFAULT_PUMPING_RULE.flagAfterDays}-day flooding rule.\n\n` +
    `${lines.slice(0, 8).join("\n")}${lines.length > 8 ? `\n…and ${lines.length - 8} more.` : ""}\n\nOpen Water in the app to confirm with the farmer.`;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

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
  return allowed ? null : json({ error: "Only an admin or manager can run the radar scan." }, 403);
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
