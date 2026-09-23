// Latest satellite pass per source — one read per session, shared by the
// header line and the dashboard panel. Dates only: the tables store the
// acquisition date, not the hour.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type SatelliteFreshness = {
  optical: string | null; // Sentinel-2 (parcel_health)
  radar: string | null; // Sentinel-1 (parcel_water)
  fires: string | null; // FIRMS (alerts.possible_burn)
  loaded: boolean;
};

let cached: Omit<SatelliteFreshness, "loaded"> | null = null;

async function latest(table: "parcel_health" | "parcel_water", col: "reading_date"): Promise<string | null> {
  const { data } = await supabase.from(table).select(col).order(col, { ascending: false }).limit(1).maybeSingle();
  return (data as { reading_date?: string } | null)?.reading_date ?? null;
}

export function useSatelliteFreshness(): SatelliteFreshness {
  const [v, setV] = useState<Omit<SatelliteFreshness, "loaded"> | null>(cached);
  useEffect(() => {
    if (cached) return;
    let cancelled = false;
    Promise.all([
      latest("parcel_health", "reading_date"),
      latest("parcel_water", "reading_date"),
      supabase
        .from("alerts")
        .select("detected_date")
        .eq("alert_type", "possible_burn")
        .order("detected_date", { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => data?.detected_date ?? null),
    ]).then(([optical, radar, fires]) => {
      cached = { optical, radar, fires };
      if (!cancelled) setV(cached);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return { optical: v?.optical ?? null, radar: v?.radar ?? null, fires: v?.fires ?? null, loaded: v !== null };
}

/** "Wet 2026" / "Dry 2026" — the same rule the contract form uses for a default season label. */
export function currentSeasonLabel(d = new Date()): string {
  const m = d.getMonth();
  return m >= 4 && m <= 9 ? `Wet ${d.getFullYear()}` : `Dry ${d.getFullYear()}`;
}
