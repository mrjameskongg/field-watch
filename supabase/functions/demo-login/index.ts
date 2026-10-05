// Demo login: hands the browser a session for the public read-only demo
// account, so no demo password lives in the client code or the repo.
//
// The service role mints a one-time magic-link token for the demo email only
// (nothing is emailed) and the anon client redeems it for a normal session.
// The demo account's real password is random and known to nobody, so a demo
// user who changes it can't lock out the next judge.
//
// verify_jwt = false: the caller is signed out by definition. It can only ever
// return the demo account, which RESTRICTIVE policies keep read-only and
// seed-only (migrations 20260831190000, 20260923130000).

import { createClient } from "jsr:@supabase/supabase-js@2";

const DEMO_EMAIL = "demo@fieldwatch.live";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: DEMO_EMAIL });
  if (linkError || !link?.properties?.hashed_token) {
    console.error("demo-login link", linkError?.message);
    return json({ error: "demo unavailable" }, 503);
  }

  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (error || !data.session) {
    console.error("demo-login verify", error?.message);
    return json({ error: "demo unavailable" }, 503);
  }

  return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
