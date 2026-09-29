// Settlement Telegram alert: fire-and-forget notification to the BRM ops
// Telegram chat whenever a settlement is created or marked paid. Called by
// the client right after the settle/mark-paid success toast (see
// src/routes/_authenticated/contracts_.$contractId.tsx) — it never blocks
// the UI and its result is ignored (`.catch(() => {})` on the client side).
//
// A missing deploy or a Telegram failure must never surface as an error to
// the person settling a contract, so this function only ever returns 400 for
// a malformed request body — everything else (missing secrets, Telegram API
// errors) comes back 200 with a body describing what happened.
//
// Required secrets — optional, without them this quietly no-ops:
//   TELEGRAM_BOT_TOKEN   bot token from @BotFather
//   TELEGRAM_CHAT_ID     target group/chat id (supergroups start with -100)
//
// verify_jwt = true in supabase/config.toml — unlike burn-scan/health-scan/
// water-scan, there is no cron caller here, only the signed-in browser
// session that just created or paid the settlement. See
// docs/DEPLOYMENT.md for setup + deploy steps.
//
// verify_jwt alone is NOT an access gate: the public anon key, the demo login
// and any self-signup all carry a valid JWT. So the caller sends only
// { event, settlement_id }; the settlement is read with THEIR JWT (RLS limits
// settlements to admin/manager) and the message is built from DB values only.

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface AlertBody {
  event: "created" | "paid";
  settlement_id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  let body: Partial<AlertBody>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  if (body.event !== "created" && body.event !== "paid") return json({ error: 'event must be "created" or "paid"' }, 400);
  if (typeof body.settlement_id !== "string" || !UUID.test(body.settlement_id)) {
    return json({ error: "settlement_id must be a uuid" }, 400);
  }

  // The caller's own JWT: RLS decides whether they may see this settlement.
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) return json({ error: "unauthorized" }, 401);

  const { data: st } = await supabase
    .from("settlements")
    .select("settlement_code, net_payment, status, contracts(contract_code, farmers(full_name))")
    .eq("id", body.settlement_id)
    .maybeSingle();
  if (!st) return json({ error: "forbidden" }, 403);
  if (body.event === "paid" && st.status !== "paid") return json({ error: "settlement is not paid" }, 409);

  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return json({ skipped: "secrets not set" });

  // deno-lint-ignore no-explicit-any
  const contract = (st as any).contracts;
  const label = body.event === "paid" ? "PAID" : "created";
  const text =
    `💰 Settlement ${st.settlement_code} ${label} — ${contract?.farmers?.full_name ?? "Unknown farmer"} ` +
    `(${contract?.contract_code ?? "?"}): net $${Number(st.net_payment).toFixed(2)}`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) {
      console.error("telegram", res.status, (await res.text()).slice(0, 200));
      return json({ error: "telegram send failed" });
    }
  } catch (e) {
    console.error("telegram", e);
    return json({ error: "telegram send failed" });
  }

  return json({ sent: true });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
