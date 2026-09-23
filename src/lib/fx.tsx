// One read of app_settings.fx per session; default 4,100 riel per dollar.
// The rate is display-only (grey USD equivalents beside KHR figures) — the
// ledger itself is stored and settled in the contract's own currency.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_KHR_PER_USD } from "@/lib/money-core";

let cached: number | null = null;

export function useFx(): { khrPerUsd: number; loaded: boolean } {
  const [rate, setRate] = useState<number | null>(cached);
  useEffect(() => {
    if (cached !== null) return;
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "fx")
      .maybeSingle()
      .then(({ data }) => {
        const v = data?.value;
        const n =
          v && typeof v === "object" && "khr_per_usd" in v
            ? Number((v as { khr_per_usd: unknown }).khr_per_usd)
            : NaN;
        cached = Number.isFinite(n) && n > 0 ? n : DEFAULT_KHR_PER_USD;
        setRate(cached);
      });
  }, []);
  return { khrPerUsd: rate ?? DEFAULT_KHR_PER_USD, loaded: rate !== null };
}

/** Call after saving a new rate so the next render re-reads it. */
export function resetFxCache() {
  cached = null;
}
