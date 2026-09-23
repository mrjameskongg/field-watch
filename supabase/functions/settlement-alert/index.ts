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

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface AlertBody {
  event: "created" | "paid";
  settlement_code: string;
  farmer_name: string;
  contract_code: string;
  net_payment: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  let body: Partial<AlertBody>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const invalid = validate(body);
  if (invalid) return json({ error: invalid }, 400);
  const alert = body as AlertBody;

  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return json({ skipped: "secrets not set" });

  const label = alert.event === "paid" ? "PAID" : "created";
  const text =
    `💰 Settlement ${alert.settlement_code} ${label} — ${alert.farmer_name} ` +
    `(${alert.contract_code}): net $${alert.net_payment.toFixed(2)}`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) {
      return json({ error: `Telegram ${res.status}: ${(await res.text()).slice(0, 200)}` });
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) });
  }

  return json({ sent: true });
});

// Minimal on purpose: just enough to keep a malformed caller from producing
// a garbled Telegram message or a runtime crash on .toFixed().
function validate(body: Partial<AlertBody>): string | null {
  if (body.event !== "created" && body.event !== "paid") return 'event must be "created" or "paid"';
  if (typeof body.net_payment !== "number" || !Number.isFinite(body.net_payment)) {
    return "net_payment must be a number";
  }
  if (!body.settlement_code || typeof body.settlement_code !== "string") return "settlement_code is required";
  if (!body.farmer_name || typeof body.farmer_name !== "string") return "farmer_name is required";
  if (!body.contract_code || typeof body.contract_code !== "string") return "contract_code is required";
  return null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
