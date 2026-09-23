// Public batch trace: the page behind the QR code on a batch.
//
// This is the ONLY function anyone on the internet can call without signing in,
// so it is deliberately narrow: it takes a batch code, and returns one
// hand-built object. Base-table RLS stays `TO authenticated` everywhere — the
// service-role key never leaves this function, and no table is exposed.
//
// What a buyer may see: the batch, its weigh-point chain, the farms behind it
// (first name, village, province, area) and the satellite record for those
// parcels. What they may NOT see: phone numbers, national ID, prices, money,
// settlements, farmer codes — none of those are selected here at all.

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  addDays,
  agreementRate,
  classifyWater,
  confidenceScore,
  crossCheck,
  rainContext,
  satelliteDrySpells,
  CANOPY_VH_DB,
  DRAINED_VV_DB,
  FLOODED_VV_DB,
  type CrossCheck,
  type LoggedWaterEvent,
  type WaterReading,
  type WaterState,
} from "./water-core.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

/** First name only — a buyer sees who grew it, not enough to go find them. */
const firstName = (full: string | null): string => (full ?? "").trim().split(/\s+/)[0] || "Unnamed";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  let code = "";
  try {
    const body = await req.json();
    code = String(body?.code ?? "").trim();
  } catch {
    return json({ error: "Send { code: \"<batch code>\" }." }, 400);
  }
  if (!code || code.length > 64) return json({ error: "Batch code missing or too long." }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: batch, error: batchError } = await supabase
    .from("batches")
    .select("id, batch_code, crop_type, custody_model, created_date, status, storage_location, variety, dryer")
    .eq("batch_code", code)
    .maybeSingle();
  if (batchError) return json({ error: batchError.message }, 500);
  if (!batch) return json({ error: "No batch with that code." }, 404);

  const [pointsRes, deliveriesRes, qcRes] = await Promise.all([
    supabase
      .from("batch_weigh_points")
      .select("stage, weight_kg, moisture_pct, recorded_date, estimated")
      .eq("batch_id", batch.id)
      .order("recorded_date", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("deliveries")
      .select("received_date, gross_weight_kg, moisture_pct, grade, contracts(season_label, crop_type, farmers(id, full_name, village, province, certifications))")
      .eq("batch_id", batch.id)
      .order("received_date", { ascending: true }),
    supabase
      .from("qc_tests")
      .select("test_type, result_value, result_text, passed, tested_date")
      .eq("batch_id", batch.id)
      .order("tested_date", { ascending: true }),
  ]);
  if (pointsRes.error) return json({ error: pointsRes.error.message }, 500);
  if (deliveriesRes.error) return json({ error: deliveriesRes.error.message }, 500);
  if (qcRes.error) return json({ error: qcRes.error.message }, 500);

  type DeliveryRow = {
    received_date: string;
    gross_weight_kg: number;
    moisture_pct: number | null;
    grade: string | null;
    contracts: {
      season_label: string | null;
      crop_type: string | null;
      farmers: {
        id: string;
        full_name: string | null;
        village: string | null;
        province: string | null;
        certifications: string | null;
      } | null;
    } | null;
  };
  const deliveries = (deliveriesRes.data ?? []) as unknown as DeliveryRow[];
  const farmerIds = [...new Set(deliveries.map((d) => d.contracts?.farmers?.id).filter(Boolean) as string[])];

  // The satellite half of the story: parcels behind these farmers, their latest
  // vegetation reading, and how often the radar agreed the field was drained.
  let farms: {
    id: string;
    farmer_id: string;
    farm_name: string | null;
    province: string | null;
    area_hectares: number | null;
    has_boundary: boolean;
    latitude: number | null;
    longitude: number | null;
  }[] = [];
  if (farmerIds.length > 0) {
    const { data, error } = await supabase
      .from("farms")
      .select("id, farmer_id, farm_name, province, area_hectares, boundary_geojson, latitude, longitude")
      .in("farmer_id", farmerIds);
    if (error) return json({ error: error.message }, 500);
    farms = (data ?? []).map((f) => ({
      id: f.id,
      farmer_id: f.farmer_id,
      farm_name: f.farm_name,
      province: f.province,
      area_hectares: f.area_hectares,
      has_boundary: f.boundary_geojson !== null,
      latitude: f.latitude,
      longitude: f.longitude,
    }));
  }

  const farmIds = farms.map((f) => f.id);
  let health: { farm_id: string; reading_date: string; ndvi: number | null }[] = [];
  let water: { farm_id: string; reading_date: string; water_state: string; vv_db: number | null; vh_db: number | null }[] = [];
  let waterLog: { farm_id: string; event_date: string; water_state: string | null }[] = [];
  let burnAlerts = 0;
  if (farmIds.length > 0) {
    const [h, w, a, e] = await Promise.all([
      supabase
        .from("parcel_health")
        .select("farm_id, reading_date, ndvi:ndvi_mean")
        .in("farm_id", farmIds)
        .order("reading_date", { ascending: false })
        .limit(200),
      supabase
        .from("parcel_water")
        .select("farm_id, reading_date, water_state:state, vv_db, vh_db")
        .in("farm_id", farmIds)
        .order("reading_date", { ascending: false })
        .limit(200),
      supabase
        .from("alerts")
        .select("id", { count: "exact", head: true })
        .in("farm_id", farmIds)
        .eq("alert_type", "possible_burn"),
      supabase
        .from("field_events")
        .select("farm_id, event_date, water_state")
        .in("farm_id", farmIds)
        .not("water_state", "is", null)
        .order("event_date", { ascending: false })
        .limit(300),
    ]);
    if (!h.error) health = h.data ?? [];
    if (!w.error) water = w.data ?? [];
    burnAlerts = a.count ?? 0;
    if (!e.error) waterLog = e.data ?? [];
  }

  // Independent rainfall record (Open-Meteo ERA5 archive, no key) so managed
  // drying can be told apart from weather. Strictly an annotation: a failed or
  // slow fetch degrades to "no rain data", never to a failed page.
  const rainByFarm: Record<string, Record<string, number>> = {};
  if (water.length > 0) {
    const passDates = water.map((r) => r.reading_date).sort();
    const rainFrom = addDays(passDates[0], -2);
    const rainTo = passDates[passDates.length - 1];
    const located = farms.filter((f) => f.latitude !== null && f.longitude !== null).slice(0, 6);
    await Promise.all(located.map(async (f) => {
      try {
        const lat = Math.round((f.latitude as number) * 1000) / 1000;
        const lng = Math.round((f.longitude as number) * 1000) / 1000;
        const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}` +
          `&start_date=${rainFrom}&end_date=${rainTo}&daily=precipitation_sum&timezone=UTC`;
        const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
        if (!res.ok) return;
        const body = await res.json() as { daily?: { time?: string[]; precipitation_sum?: (number | null)[] } };
        const days = body.daily?.time ?? [];
        const mm = body.daily?.precipitation_sum ?? [];
        const byDate: Record<string, number> = {};
        days.forEach((d, i) => {
          const v = mm[i];
          if (typeof v === "number" && Number.isFinite(v)) byDate[d] = v;
        });
        rainByFarm[f.id] = byDate;
      } catch {
        // no rain data for this parcel — the page says so instead of guessing
      }
    }));
  }

  const farmersOut = farmerIds.map((id) => {
    const row = deliveries.find((d) => d.contracts?.farmers?.id === id)?.contracts?.farmers ?? null;
    const theirFarms = farms.filter((f) => f.farmer_id === id);
    const theirFarmIds = theirFarms.map((f) => f.id);
    const latestHealth = health.find((r) => theirFarmIds.includes(r.farm_id)) ?? null;
    const theirWater = water.filter((r) => theirFarmIds.includes(r.farm_id));

    // Chronological pass series with verdicts recomputed from raw decibels —
    // the stored state is never trusted blind, and the page shows its work.
    // One parcel only: mixing parcels into one line would chart nonsense, so
    // the evidence series is the farmer's best-observed parcel, and the field
    // log is compared strictly against that same parcel.
    const passesByFarm = new Map<string, number>();
    for (const r of theirWater) passesByFarm.set(r.farm_id, (passesByFarm.get(r.farm_id) ?? 0) + 1);
    const evidenceFarmId = [...passesByFarm.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const chrono = [...theirWater].filter((r) => r.farm_id === evidenceFarmId).reverse().slice(-40);
    const theirLog: LoggedWaterEvent[] = waterLog
      .filter((r) => r.farm_id === evidenceFarmId)
      .map((r) => ({ event_date: r.event_date, water_state: r.water_state }));
    const checks: CrossCheck[] = [];
    const radarSeries = chrono
      .filter((r) => typeof r.vv_db === "number" && typeof r.vh_db === "number")
      .map((r) => {
        const reading: WaterReading = {
          reading_date: r.reading_date,
          vv_db: r.vv_db as number,
          vh_db: r.vh_db as number,
        };
        const verdict = classifyWater(reading);
        const check = crossCheck(reading, verdict, theirLog);
        checks.push(check);
        const rain = rainContext(r.reading_date, verdict.state as WaterState,
          rainByFarm[r.farm_id] ?? {});
        void check;
        return {
          date: r.reading_date,
          vv_db: reading.vv_db,
          vh_db: reading.vh_db,
          state: verdict.state,
          confidence: confidenceScore(reading),
          rain,
        };
      });
    const decisive = checks.filter((c) => c.agreement === "agrees" || c.agreement === "disagrees");
    const ndviSeries = health
      .filter((r) => theirFarmIds.includes(r.farm_id) && r.ndvi !== null)
      .slice(0, 6)
      .reverse()
      .map((r) => ({ date: r.reading_date, ndvi: r.ndvi }));

    return {
      name: firstName(row?.full_name ?? null),
      village: row?.village ?? null,
      province: row?.province ?? null,
      certifications: row?.certifications ?? null,
      hectares: theirFarms.reduce((s, f) => s + (f.area_hectares ?? 0), 0) || null,
      mapped_parcels: theirFarms.filter((f) => f.has_boundary).length,
      latest_ndvi: latestHealth?.ndvi ?? null,
      latest_ndvi_date: latestHealth?.reading_date ?? null,
      radar_passes: theirWater.length,
      radar_drained: theirWater.filter((r) => r.water_state === "drained").length,
      radar_series: radarSeries,
      ndvi_series: ndviSeries,
      dry_spells: satelliteDrySpells(radarSeries.map((r) => ({ state: r.state }))),
      log_agreement: {
        decisive: decisive.length,
        agreed: decisive.filter((c) => c.agreement === "agrees").length,
        rate: agreementRate(checks),
      },
      delivered_kg: deliveries
        .filter((d) => d.contracts?.farmers?.id === id)
        .reduce((s, d) => s + d.gross_weight_kg, 0),
    };
  });

  // Map dots for the public page. Coordinates are rounded to ~110 m and the
  // exact boundary polygon is never published — a buyer sees WHERE the rice
  // grew, not the surveyed edges of someone's land.
  const farmPoints = farms
    .filter((f) => f.latitude !== null && f.longitude !== null)
    .map((f) => {
      const farmer = deliveries.find((d) => d.contracts?.farmers?.id === f.farmer_id)?.contracts?.farmers;
      const latest = health.find((r) => r.farm_id === f.id) ?? null;
      return {
        farmer: firstName(farmer?.full_name ?? null),
        village: farmer?.village ?? null,
        lat: Math.round((f.latitude as number) * 1000) / 1000,
        lng: Math.round((f.longitude as number) * 1000) / 1000,
        hectares: f.area_hectares,
        mapped: f.has_boundary,
        ndvi: latest?.ndvi ?? null,
        ndvi_date: latest?.reading_date ?? null,
      };
    });

  return json({
    batch: {
      code: batch.batch_code,
      crop: batch.crop_type,
      custody_model: batch.custody_model,
      created_date: batch.created_date,
      status: batch.status,
      storage_location: batch.storage_location,
      variety: batch.variety ?? null,
      dryer: batch.dryer ?? null,
      season: deliveries.find((d) => d.contracts?.season_label)?.contracts?.season_label ?? null,
    },
    weigh_points: pointsRes.data ?? [],
    intake: deliveries.map((d) => ({
      received_date: d.received_date,
      weight_kg: d.gross_weight_kg,
      moisture_pct: d.moisture_pct,
      grade: d.grade,
      farmer: firstName(d.contracts?.farmers?.full_name ?? null),
      village: d.contracts?.farmers?.village ?? null,
    })),
    farmers: farmersOut,
    qc_tests: qcRes.data ?? [],
    burn_alerts: burnAlerts,
    farm_points: farmPoints,
    methodology: {
      radar: "Sentinel-1 GRD, gamma0, Lee 5x5 speckle filter, 10 m, mean over the mapped parcel",
      optical: "Sentinel-2 L2A NDVI, 10 m, cloud-filtered",
      rain: "Open-Meteo ERA5 daily precipitation at the parcel location",
      flooded_vv_db: FLOODED_VV_DB,
      drained_vv_db: DRAINED_VV_DB,
      canopy_vh_db: CANOPY_VH_DB,
    },
  });
});
