import { createServerFn } from "@tanstack/react-start";
import {
  BURN_ZONE,
  DRY_SEASON_2026,
  WATCH_BBOX,
  dedupeHotspots,
  inZone,
  parseFirmsCsv,
  seasonWindows,
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

// Archive ("standard processing") feed. NRT only reaches back a couple of months.
const SEASON_SOURCE = "VIIRS_SNPP_SP";
// ponytail: per-isolate cache; the archive for a past season never changes, so a cold
// isolate just refetches (24 requests). Move to a table if the season list grows.
let seasonCache: Promise<HotspotResult> | null = null;

/**
 * Fires detected around the estate and the contract farms in the last dry season,
 * from the NASA FIRMS archive. 24 five-day requests, fetched once per server isolate.
 */
export const fetchSeasonFires = createServerFn({ method: "GET" }).handler(async (): Promise<HotspotResult> => {
  const key = process.env.FIRMS_MAP_KEY;
  if (!key) return { hotspots: [], error: "FIRMS_MAP_KEY is not set — add it to .env (see SETUP.md)." };
  seasonCache ??= (async (): Promise<HotspotResult> => {
    const windows = seasonWindows(DRY_SEASON_2026.from, DRY_SEASON_2026.to);
    try {
      const texts = await Promise.all(
        windows.map(async (w) => {
          const res = await fetch(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${SEASON_SOURCE}/${WATCH_BBOX}/${w.days}/${w.date}`);
          const text = await res.text();
          if (!res.ok || text.startsWith("Invalid")) throw new Error(`FIRMS error (${SEASON_SOURCE} ${w.date}): ${text.slice(0, 120)}`);
          return text;
        }),
      );
      return { hotspots: dedupeHotspots(texts.flatMap(parseFirmsCsv)) };
    } catch (e) {
      seasonCache = null; // do not pin a failure for the life of the isolate
      return { hotspots: [], error: e instanceof Error ? e.message : String(e) };
    }
  })();
  return seasonCache;
});

