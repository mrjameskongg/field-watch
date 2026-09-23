// Pure arithmetic behind "Mill at a glance". Every number on the dashboard
// is derived here from ledger rows so it can be unit-tested against the seed
// and never disagrees with /stock, /deliveries or /batches.

import { stageLabel, stageTotals, type WeighPointLite } from "./batch-core";
import { dispatchProductLabel } from "./labels";
import { asCurrency, type Currency } from "./money-core";
import { round2 } from "./trade-core";
import { daysBetween } from "./water-core";

type ContractLite = { currency?: string | null; season_closed?: boolean | null } | null;

export type MoneyDelivery = {
  gross_weight_kg: number;
  price_per_kg_applied: number;
  settlement_id: string | null;
  contracts: ContractLite;
};

export type MoneySettlement = {
  status: string;
  net_payment: number;
  contracts: ContractLite;
};

export type MoneyStrip = {
  kgBought: number;
  paid: Record<Currency, number>;
  owed: Record<Currency, number>;
};

const zero = (): Record<Currency, number> => ({ USD: 0, KHR: 0 });
const isOpen = (c: ContractLite) => c?.season_closed !== true;

export function moneyStrip(deliveries: MoneyDelivery[], settlements: MoneySettlement[]): MoneyStrip {
  const owed = zero();
  const paid = zero();
  let kgBought = 0;
  for (const d of deliveries) {
    if (!isOpen(d.contracts)) continue;
    kgBought += d.gross_weight_kg;
    if (d.settlement_id === null) owed[asCurrency(d.contracts?.currency)] += d.gross_weight_kg * d.price_per_kg_applied;
  }
  for (const s of settlements) {
    if (!isOpen(s.contracts) || s.status !== "paid") continue;
    paid[asCurrency(s.contracts?.currency)] += s.net_payment;
  }
  return {
    kgBought: round2(kgBought),
    paid: { USD: round2(paid.USD), KHR: round2(paid.KHR) },
    owed: { USD: round2(owed.USD), KHR: round2(owed.KHR) },
  };
}

export type OpenBatchBalance = {
  batches: number;
  receivedKg: number;
  driedKg: number;
  intoMillKg: number;
  outputsKg: number;
  wastageKg: number;
  /** into_mill minus (outputs + wastage); 0 is the number a mill wants to show. */
  unaccountedKg: number;
  /** Dried paddy put into store on open batches (jumbo bags, usually estimated). */
  storedKg: number;
  storedEstimated: boolean;
};

const DONE = new Set(["shipped", "closed"]);
const OUTPUT_STAGES = ["milled_output", "broken", "bran", "husk"];

export function openBatchBalance(
  batches: { id: string; status: string }[],
  points: (WeighPointLite & { batch_id: string })[],
): OpenBatchBalance {
  const openIds = new Set(batches.filter((b) => !DONE.has(b.status)).map((b) => b.id));
  const openPoints = points.filter((p) => openIds.has(p.batch_id));
  const totals = stageTotals(openPoints);
  const outputsKg = OUTPUT_STAGES.reduce((s, k) => s + (totals[k] ?? 0), 0);
  const wastageKg = totals.wastage ?? 0;
  const intoMillKg = totals.into_mill ?? 0;
  return {
    batches: openIds.size,
    receivedKg: round2(totals.received ?? 0),
    driedKg: round2(totals.post_drying ?? 0),
    intoMillKg: round2(intoMillKg),
    outputsKg: round2(outputsKg),
    wastageKg: round2(wastageKg),
    unaccountedKg: intoMillKg > 0 ? round2(intoMillKg - outputsKg - wastageKg) : 0,
    storedKg: round2(totals.into_storage ?? 0),
    storedEstimated: openPoints.some((p) => p.stage === "into_storage" && p.estimated === true),
  };
}

export type ActivityKind = "delivery" | "weigh" | "payment" | "dispatch";

export type ActivityRow = {
  date: string;
  kind: ActivityKind;
  label: string;
  kg: number | null;
  to: string;
};

export type ActivityInput = {
  deliveries: { delivery_code: string; received_date: string; gross_weight_kg: number; farmer: string | null }[];
  weighPoints: { batch_code: string; recorded_date: string; stage: string; weight_kg: number }[];
  settlements: { settlement_code: string; settled_date: string; net_payment: number; currency: string | null }[];
  dispatches: { dispatch_code: string; dispatched_date: string; product: string; weight_kg: number }[];
};

const KIND_ORDER: Record<ActivityKind, number> = { weigh: 0, payment: 1, dispatch: 2, delivery: 3 };

export function recentActivity(input: ActivityInput, limit: number): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const d of input.deliveries) {
    rows.push({ date: d.received_date, kind: "delivery", label: `${d.delivery_code} · ${d.farmer ?? "—"}`, kg: d.gross_weight_kg, to: "/deliveries" });
  }
  for (const w of input.weighPoints) {
    rows.push({ date: w.recorded_date, kind: "weigh", label: `${w.batch_code} · ${stageLabel(w.stage)}`, kg: w.weight_kg, to: "/batches" });
  }
  for (const s of input.settlements) {
    rows.push({ date: s.settled_date, kind: "payment", label: `${s.settlement_code} · ${asCurrency(s.currency)}`, kg: null, to: "/contracts" });
  }
  for (const x of input.dispatches) {
    rows.push({ date: x.dispatched_date, kind: "dispatch", label: `${x.dispatch_code} · ${dispatchProductLabel(x.product)}`, kg: x.weight_kg, to: "/dispatches" });
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : KIND_ORDER[a.kind] - KIND_ORDER[b.kind]));
  return rows.slice(0, limit);
}

/** Date-only freshness for the header line: "today", "3 d", or a dash. */
export function freshnessLabel(iso: string | null | undefined, today: string): string {
  if (!iso) return "—";
  const days = daysBetween(iso.slice(0, 10), today);
  if (days <= 0) return "today";
  return `${days} d`;
}

/* ------------------------------------------------------------------ */
/* Radar vs logbook agreement over a window                            */
/* ------------------------------------------------------------------ */

export type PassLite = { farm_id: string; reading_date: string; state: string; confident: boolean };
export type WaterLogLite = { farm_id: string; event_date: string; event_type: string; water_state: string | null };

export const AGREEMENT_WINDOW_DAYS = 6;

/**
 * For every confident radar pass, find the nearest logged water event on the
 * same farm within the window; count a match when the states agree. Passes
 * with no nearby log are not compared — an auditor wants two records of the
 * same moment, not a guess.
 */
export function radarAgreement(passes: PassLite[], logs: WaterLogLite[]): { compared: number; agreed: number; pct: number | null } {
  const byFarm = new Map<string, WaterLogLite[]>();
  for (const l of logs) {
    if (l.event_type !== "water" || (l.water_state !== "flooded" && l.water_state !== "drained")) continue;
    const list = byFarm.get(l.farm_id) ?? [];
    list.push(l);
    byFarm.set(l.farm_id, list);
  }
  let compared = 0;
  let agreed = 0;
  for (const p of passes) {
    if (!p.confident || (p.state !== "flooded" && p.state !== "drained")) continue;
    const candidates = byFarm.get(p.farm_id) ?? [];
    let best: WaterLogLite | null = null;
    let bestGap = Infinity;
    for (const c of candidates) {
      const gap = Math.abs(daysBetween(c.event_date, p.reading_date));
      if (gap <= AGREEMENT_WINDOW_DAYS && gap < bestGap) {
        best = c;
        bestGap = gap;
      }
    }
    if (!best) continue;
    compared++;
    if (best.water_state === p.state) agreed++;
  }
  return { compared, agreed, pct: compared === 0 ? null : Math.round((agreed / compared) * 100) };
}
