// Water discipline: which parcels are being kept flooded when they should have
// been allowed to dry.
//
// Richard's ask, in his words: step one is telling whether a field is dry —
// that ships already as the Sentinel-1 water scan. Step two is "in this section
// of our land, they seem to be pumping more than they should". This file is
// step two.
//
// The physics is unusually kind here. classifyWater() marks a flooded reading
// confident ALWAYS, because vegetation only ever raises backscatter, so a dark
// VV cannot be a canopy artefact. Drained readings are the shaky direction:
// under a closed canopy they get confident:false. Over-pumping detection counts
// flooded passes, which is exactly the half of the signal that is trustworthy.
//
// The asymmetry that follows is deliberate, and it runs in the farmer's favour:
//   - Accusing a field of never drying needs flooded evidence and NO drying
//     signal of any kind — an unconfident drained reading, or a drain the
//     officer wrote in the logbook, is enough to call off the accusation.
//   - Confirming that a field practised AWD needs a CONFIDENT drained reading.
//
// What this can never do: water table depth. Real AWD calls for re-flooding
// when water sits ~15 cm below the surface, which is a field-tube reading.
// Radar sees the surface only. This file detects; it does not advise.
//
// Pure: no supabase, no react.

import { daysBetween } from "./water-core";

/** A row of parcel_water, trimmed to what the streak needs. */
export interface PassRow {
  reading_date: string;
  state: string;
  confident: boolean;
}

/** A field_events row. Only water drain-downs matter here. */
export interface DrainLog {
  event_type: string;
  water_state: string | null;
  event_date: string;
}

export interface FloodStreak {
  /** Flooded passes since the field was last known to be dry. */
  passes: number;
  /** Days from the last known dry moment to the most recent decisive pass. */
  daysFlooded: number;
  /** Last dry evidence of any kind — radar or logbook. Null if there is none. */
  lastDrainedDate: string | null;
  /** True when nothing in the record shows this parcel ever drying. */
  neverDrained: boolean;
  /** True when radar itself confirmed a dry-down, canopy notwithstanding. */
  confirmedDry: boolean;
  /** Most recent decisive pass. Null when the parcel has never been scanned. */
  latestPass: string | null;
}

const isDrainLog = (l: DrainLog) => l.event_type === "water" && l.water_state === "drained";

/**
 * Reduce a parcel's radar history and logbook into one streak.
 *
 * Uncertain passes are skipped entirely: a reading between the thresholds is
 * not evidence in either direction, so it neither extends a streak nor ends one.
 */
export function floodStreak(rows: PassRow[], logs: DrainLog[]): FloodStreak {
  const decisive = rows
    .filter((r) => r.state === "flooded" || r.state === "drained")
    .slice()
    .sort((a, b) => a.reading_date.localeCompare(b.reading_date));

  if (decisive.length === 0) {
    return {
      passes: 0,
      daysFlooded: 0,
      lastDrainedDate: null,
      neverDrained: false,
      confirmedDry: false,
      latestPass: null,
    };
  }

  const latestPass = decisive[decisive.length - 1].reading_date;

  const drainedRows = decisive.filter((r) => r.state === "drained");
  const lastRadarDrain = drainedRows.length ? drainedRows[drainedRows.length - 1].reading_date : null;

  // Sentinel-1 revisits every 6-12 days, so a short dry-down can fall between
  // passes entirely. The officer's logbook is the second chance to see it.
  const loggedDrains = logs
    .filter(isDrainLog)
    .map((l) => l.event_date)
    .sort();
  const lastLoggedDrain = loggedDrains.length ? loggedDrains[loggedDrains.length - 1] : null;

  const lastDrainedDate =
    lastRadarDrain && lastLoggedDrain
      ? lastRadarDrain > lastLoggedDrain
        ? lastRadarDrain
        : lastLoggedDrain
      : (lastRadarDrain ?? lastLoggedDrain);

  const anchor = lastDrainedDate ?? decisive[0].reading_date;

  const passes = decisive.filter(
    (r) => r.state === "flooded" && (lastDrainedDate === null || r.reading_date > lastDrainedDate),
  ).length;

  return {
    passes,
    daysFlooded: Math.max(0, daysBetween(anchor, latestPass)),
    lastDrainedDate,
    neverDrained: lastDrainedDate === null,
    confirmedDry: drainedRows.some((r) => r.confident),
    latestPass,
  };
}

/* ------------------------------------------------------------------ */
/* The flag                                                            */
/* ------------------------------------------------------------------ */

/**
 * How long a parcel may stay continuously flooded before it is worth a look.
 *
 * This number is an operating rule, not agronomy. AWD practice is usually
 * described as a dry-down of several days at least once mid-season, but the
 * right figure for BRM's varieties and calendar is the agronomist's to give. It is
 * settable so nobody has to take this file's word for it.
 */
export const DEFAULT_PUMPING_RULE: PumpingRule = { flagAfterDays: 21 };

/** Past this, the last scan is too old to make any claim about today. */
export const STALE_AFTER_DAYS = 21;

export interface PumpingRule {
  flagAfterDays: number;
}

export type PumpFlag = "never-dried" | "watch" | "ok" | "stale" | "no-data";

export interface PumpFlagInput {
  latestPass: string | null;
  today: string;
  daysFlooded: number;
  neverDrained: boolean;
}

export function pumpFlag(input: PumpFlagInput, rule: PumpingRule): PumpFlag {
  if (!input.latestPass) return "no-data";
  if (daysBetween(input.latestPass, input.today) > STALE_AFTER_DAYS) return "stale";
  if (input.daysFlooded >= rule.flagAfterDays) return input.neverDrained ? "never-dried" : "watch";
  return "ok";
}

/* ------------------------------------------------------------------ */
/* Diesel corroboration                                                */
/* ------------------------------------------------------------------ */

/**
 * BRM advances the diesel that runs the pumps, which means the fuel ledger and
 * the radar record are two independent views of the same decision. Nobody
 * selling traceability software has both sides of that.
 *
 * Corroboration only, never the flag itself: an advance is booked against a
 * contract, and a contract can cover more ground than the one parcel.
 */
const DIESEL_TYPES = new Set(["diesel", "fuel"]);
const LITRE_UNITS = new Set(["l", "litre", "litres", "liter", "liters"]);

export interface AdvanceRow {
  item_type: string;
  quantity: number | null;
  unit: string | null;
}

/** Litres of diesel advanced per contracted hectare. Null when unknowable. */
export function dieselPerHa(advances: AdvanceRow[], hectares: number): number | null {
  if (!hectares || hectares <= 0) return null;

  // A quantity in a unit this function cannot read is skipped rather than
  // summed blind — a wrong litres-per-hectare is worse than none.
  const litres = advances
    .filter((a) => DIESEL_TYPES.has(a.item_type.trim().toLowerCase()))
    .filter((a) => a.quantity !== null && LITRE_UNITS.has((a.unit ?? "").trim().toLowerCase()))
    .reduce((sum, a) => sum + (a.quantity as number), 0);

  if (litres <= 0) return null;
  return Math.round((litres / hectares) * 100) / 100;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export type DieselSignal = "above" | "typical" | "below" | "unknown";

/** A quarter clear of the estate median either way is worth showing. */
export const DIESEL_BAND = 0.25;

export function dieselSignal(value: number | null, estateMedian: number | null): DieselSignal {
  if (value === null || estateMedian === null || estateMedian <= 0) return "unknown";
  const ratio = value / estateMedian;
  if (ratio >= 1 + DIESEL_BAND) return "above";
  if (ratio <= 1 - DIESEL_BAND) return "below";
  return "typical";
}

/* ------------------------------------------------------------------ */
/* The screen row                                                      */
/* ------------------------------------------------------------------ */

export interface PumpingRow extends FloodStreak {
  farmId: string;
  farmName: string;
  farmerName: string | null;
  flag: PumpFlag;
  dieselPerHa: number | null;
  diesel: DieselSignal;
}

const FLAG_ORDER: Record<PumpFlag, number> = {
  "never-dried": 0,
  watch: 1,
  ok: 2,
  stale: 3,
  "no-data": 4,
};

/** Worst first: the point of the screen is the top of the list. */
export function sortByPumping(rows: PumpingRow[]): PumpingRow[] {
  return rows.slice().sort((a, b) => {
    const byFlag = FLAG_ORDER[a.flag] - FLAG_ORDER[b.flag];
    if (byFlag !== 0) return byFlag;
    if (b.daysFlooded !== a.daysFlooded) return b.daysFlooded - a.daysFlooded;
    return a.farmName.localeCompare(b.farmName);
  });
}
