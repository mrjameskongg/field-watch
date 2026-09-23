// "Ask your mill" — natural-language Q&A over the caller's own farm data.
//
// The signed-in user asks a question in Khmer or English; this function pulls
// a compact snapshot of what THAT USER is allowed to see (their JWT + the anon
// key, so every query runs under normal RLS — no service-role shortcut), and
// sends snapshot + question to the Lovable AI gateway. The model answers from
// the snapshot only.
//
// Caller: the signed-in browser session (verify_jwt = true in config.toml).
// Secrets: LOVABLE_API_KEY (auto-provisioned by Lovable Cloud),
//          SUPABASE_URL / SUPABASE_ANON_KEY (set automatically by Supabase).

import { createClient } from "jsr:@supabase/supabase-js@2";

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

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
// Tried in order; the first model the gateway accepts is remembered for the
// life of this isolate. Gateway model names drift — don't hard-fail on one.
const MODEL_CANDIDATES = [
  "google/gemini-3.7-flash",
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-flash",
];
let workingModel: string | null = null;

const SYSTEM_PROMPT = `You are the assistant for BRM Agro Field Watch, a rice farm-to-mill traceability system in Kampong Thom, Cambodia.

You will receive a JSON snapshot of the mill's live data (farmers, farms, contracts, deliveries, quality tests, batches, alerts) followed by a question from a mill staff member.

Rules:
- Answer ONLY from the snapshot. If the data isn't in the snapshot, say so plainly — never invent numbers, names, or dates.
- Answer in the same language as the question: Khmer question → answer in Khmer; English question → answer in English.
- Quote exact figures (kg, hectares, percentages) from the data. Round derived figures to 1 decimal.
- Weights are kg unless stated; areas are hectares; moisture is %.
- Be concise: a direct answer first, then at most 2-3 supporting lines. Use a short list or table only when comparing several items.
- If asked something outside mill/farm data (politics, general knowledge), say you only answer about the mill's data.
- Speak the operator's language, never the database's: no column or table names, no ids, no SQL terms. Say "not paid yet", never "settlement_id is null".`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  let question = "";
  try {
    const body = await req.json();
    question = String(body?.question ?? "").trim();
  } catch {
    return json({ error: 'Send { question: "..." }.' }, 400);
  }
  if (!question) return json({ error: "Question is empty." }, 400);
  if (question.length > 1000) return json({ error: "Question too long (max 1000 chars)." }, 400);

  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (!lovableKey) return json({ error: "LOVABLE_API_KEY is not set on this function." }, 500);

  // The caller's own JWT + anon key: every read below is RLS-checked as them.
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const [farmers, farms, contracts, deliveries, qc, batches, weighPoints, alerts] = await Promise.all([
    supabase.from("farmers").select("farmer_code,full_name,gender,district,province,contract_status,status,notes").limit(100),
    supabase.from("farms").select("farm_code,farm_name,district,area_hectares,crop_type,planting_date,risk_level,status").limit(100),
    supabase.from("contracts").select("*").limit(50),
    supabase.from("deliveries").select("*").gte("received_date", since).order("received_date", { ascending: false }).limit(200),
    supabase.from("qc_tests").select("*").limit(100),
    supabase.from("batches").select("*").limit(20),
    supabase.from("batch_weigh_points").select("*").limit(100),
    supabase.from("alerts").select("alert_type,status,severity,created_at,notes").neq("status", "resolved").limit(50),
  ]);

  const snapshot = {
    today: new Date().toISOString().slice(0, 10),
    note: "deliveries cover the last 90 days only; older ones are not in this snapshot",
    farmers: farmers.data ?? [],
    farms: farms.data ?? [],
    contracts: contracts.data ?? [],
    deliveries: deliveries.data ?? [],
    qc_tests: qc.data ?? [],
    batches: batches.data ?? [],
    batch_weigh_points: weighPoints.data ?? [],
    open_alerts: alerts.data ?? [],
  };

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `DATA SNAPSHOT:\n${JSON.stringify(snapshot)}\n\nQUESTION: ${question}` },
  ];

  const candidates = workingModel ? [workingModel] : MODEL_CANDIDATES;
  let lastErr = "";
  for (const model of candidates) {
    const resp = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages }),
    });
    if (resp.ok) {
      const data = await resp.json();
      const answer = data?.choices?.[0]?.message?.content ?? "";
      if (answer) {
        workingModel = model;
        return json({ answer, model });
      }
      lastErr = "Gateway returned an empty answer.";
      continue;
    }
    lastErr = `Gateway ${resp.status}: ${(await resp.text()).slice(0, 300)}`;
    // 429/402 = quota problems — retrying other model names won't help.
    if (resp.status === 429 || resp.status === 402) break;
  }
  return json({ error: lastErr || "All model candidates failed." }, 502);
});
