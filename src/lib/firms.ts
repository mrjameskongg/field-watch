import { createServerFn } from "@tanstack/react-start";
import {
  BURN_ZONE,
  dedupeHotspots,
  inZone,
  parseFirmsCsv,
  zoneBbox,
  type Hotspot,
} from "./firms-core";

const FIRMS_SOURCES = ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT"] as const;

export interface HotspotResult {
  hotspots: Hotspot[];
  error?: string;
}

/**
 * Fetch active-fire hotspots inside the BRM monitor zone from NASA FIRMS.
 * Runs on the server so the MAP_KEY never reaches the browser.
 */
export const fetchHotspots = createServerFn({ method: "GET" })
  .inputValidator((input: { days: number }) => ({
    // FIRMS NRT area API accepts 1–5 days lookback.
    days: Math.min(Math.max(Math.round(input?.days ?? 3), 1), 5),
  }))
  .handler(async ({ data }): Promise<HotspotResult> => {
    const key = process.env.FIRMS_MAP_KEY;
    if (!key) {
      return { hotspots: [], error: "FIRMS_MAP_KEY is not set — add it to .env (see SETUP.md)." };
    }

    const bbox = zoneBbox(BURN_ZONE);
    const all: Hotspot[] = [];
    for (const source of FIRMS_SOURCES) {
      const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${source}/${bbox}/${data.days}`;
      let res: Response;
      try {
        res = await fetch(url);
      } catch (e) {
        return { hotspots: [], error: `FIRMS unreachable: ${e instanceof Error ? e.message : String(e)}` };
      }
      const text = await res.text();
      if (!res.ok || text.startsWith("Invalid")) {
        // FIRMS returns 200 with "Invalid MAP_KEY." style bodies on bad keys.
        return { hotspots: [], error: `FIRMS error (${source}): ${text.slice(0, 120)}` };
      }
      all.push(...parseFirmsCsv(text));
    }

    return { hotspots: dedupeHotspots(all).filter((h) => inZone(h, BURN_ZONE)) };
  });
