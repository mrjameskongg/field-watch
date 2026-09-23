// Pure season/crop-cycle logic — no supabase, no React, fully unit-tested.
// Same pattern as health-core.ts (though nothing here is copied to an edge
// function). All dates are "YYYY-MM-DD" strings, as stored.

export const KG_PER_BAG = 50;

export type EventType = "planting" | "fertiliser" | "pesticide" | "water" | "other";
export type WaterState = "flooded" | "drained";
export type EventUnit = "kg" | "L" | "bags";

export interface CycleRow {
  id: string;
  season_label: string;
  planting_date: string;
  expected_harvest_date: string | null;
  harvest_date: string | null;
  yield_kg: number | null;
  status: string; // 'active' | 'closed'
  seed_variety: string | null;
}

export interface EventRow {
  id: string;
  event_type: string;
  event_date: string;
  product: string | null;
  quantity: number | null;
  unit: string | null;
  water_state: string | null;
  water_depth_cm: number | null;
  note: string | null;
}

/**
 * Suggest a season label from a planting date. Cambodian rice calendar:
 * May–October plantings are the wet season, November–April the dry season.
 * A November/December planting belongs to the dry season that mostly runs
 * in the following year, so it is labelled with that year.
 */
export function suggestSeasonLabel(plantingDate: string): string {
  const d = new Date(plantingDate + "T00:00:00Z");
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();
  if (month >= 5 && month <= 10) return `Wet ${year}`;
  if (month >= 11) return `Dry ${year + 1}`;
  return `Dry ${year}`;
}

/** Whole days from planting to harvest (closed) or to `today` (active). */
export function daysInSeason(cycle: Pick<CycleRow, "planting_date" | "harvest_date">, today: string): number {
  const end = cycle.harvest_date ?? today;
  const ms = new Date(end + "T00:00:00Z").getTime() - new Date(cycle.planting_date + "T00:00:00Z").getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

/**
 * Season progress 0..1 against the expected harvest date, or null when no
 * expectation was recorded. Clamped — a season past its expected date reads
 * 100%, not 130%.
 */
export function seasonProgress(
  cycle: Pick<CycleRow, "planting_date" | "expected_harvest_date">,
  today: string,
): number | null {
  if (!cycle.expected_harvest_date) return null;
  const start = new Date(cycle.planting_date + "T00:00:00Z").getTime();
  const end = new Date(cycle.expected_harvest_date + "T00:00:00Z").getTime();
  if (end <= start) return null;
  const now = new Date(today + "T00:00:00Z").getTime();
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

/** Count of water events recorded as drained — the AWD "dry spell" tally. */
export function drySpellCount(events: Pick<EventRow, "event_type" | "water_state">[]): number {
  return events.filter((e) => e.event_type === "water" && e.water_state === "drained").length;
}

/**
 * Total fertiliser applied, in kg. Bags convert at KG_PER_BAG; litres are a
 * different dimension and are deliberately left out of the kg total.
 */
export function fertiliserTotalKg(
  events: Pick<EventRow, "event_type" | "quantity" | "unit">[],
): number {
  let total = 0;
  for (const e of events) {
    if (e.event_type !== "fertiliser" || e.quantity == null) continue;
    if (e.unit === "bags") total += e.quantity * KG_PER_BAG;
    else if (e.unit === "kg" || e.unit == null) total += e.quantity;
  }
  return Math.round(total * 100) / 100;
}

export function bagsToKg(bags: number, kgPerBag: number = KG_PER_BAG): number {
  return bags * kgPerBag;
}

/** Which fields the log-event form shows for each type. */
export function eventFields(type: EventType): {
  water: boolean;
  product: boolean;
  note: boolean;
} {
  if (type === "water") return { water: true, product: false, note: true };
  if (type === "fertiliser" || type === "pesticide") return { water: false, product: true, note: true };
  return { water: false, product: false, note: true }; // planting / other
}

/** Events may only be added to an active cycle. */
export function canLogEvent(cycle: Pick<CycleRow, "status"> | null): boolean {
  return cycle?.status === "active";
}

/**
 * Closing a season requires a harvest date and a positive yield — that is
 * the exit toll that keeps history auditable.
 */
export function canCloseSeason(input: { harvestDate: string; yieldValue: number | null }): {
  ok: boolean;
  reason?: string;
} {
  if (!input.harvestDate) return { ok: false, reason: "Harvest date is required." };
  if (input.yieldValue == null || Number.isNaN(input.yieldValue) || input.yieldValue <= 0)
    return { ok: false, reason: "Yield is required to close a season." };
  return { ok: true };
}

/** Planting is offered only while the cycle has no planting event yet. */
export function offerPlanting(events: Pick<EventRow, "event_type">[]): boolean {
  return !events.some((e) => e.event_type === "planting");
}

/** One-line summary of an event for the compressed card list and ledger. */
export function eventSummary(e: EventRow): string {
  switch (e.event_type) {
    case "water":
      return e.water_state === "drained"
        ? `Field drained${e.water_depth_cm != null ? ` (${e.water_depth_cm} cm below surface)` : ""}`
        : `Field flooded${e.water_depth_cm != null ? ` (${e.water_depth_cm} cm)` : ""}`;
    case "fertiliser":
    case "pesticide": {
      const qty = e.quantity != null ? ` — ${e.quantity} ${e.unit ?? "kg"}` : "";
      return `${e.product ?? (e.event_type === "fertiliser" ? "Fertiliser" : "Pesticide")}${qty}`;
    }
    case "planting":
      return e.note ? `Planted — ${e.note}` : "Planted";
    default:
      return e.note ?? "Note";
  }
}

/** A row that may carry its contract's season_closed flag through a join. */
export type ClosedAware = { contracts?: { season_closed?: boolean | null } | null };

/** Rows from open seasons only. A missing join means "open" — never hide data by accident. */
export function openOnly<T extends ClosedAware>(rows: T[]): T[] {
  return rows.filter((r) => r.contracts?.season_closed !== true);
}
