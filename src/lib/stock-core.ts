// Derived stock-on-hand: computed live from deliveries and batch weigh
// points — never typed in, never stored. ERPNext lesson (MooMoo): stock that
// is entered twice drifts; stock derived from weighed movements cannot.
// Read-only v1 — there is no dispatch/sales table yet, so every milled
// output is on hand by definition (the page says so honestly).

import { round2 } from "./trade-core";
import { stageTotals, type WeighPointLite } from "./batch-core";
import { dispatchedByProduct, type DispatchLite } from "./dispatch-core";

export type StockDeliveryLite = {
  id: string;
  gross_weight_kg: number;
  batch_id: string | null;
};

export type StockBatchLite = {
  id: string;
  batch_code: string;
  status: string;
  crop_type: string;
  variety: string | null;
  created_date: string;
};

export type StockWeighLite = WeighPointLite & { batch_id: string; recorded_date?: string };

export type BatchStockRow = {
  batchId: string;
  batchCode: string;
  status: string;
  cropType: string;
  variety: string | null;
  createdDate: string;
  receivedKg: number;
  driedKg: number;
  /** Put into store as jumbo bags (mill manager, 8 Sep 2026: estimated, not weighed). null = went straight to the mill. */
  storedKg: number | null;
  intoMillKg: number;
  /** (into_storage if present, else post_drying) minus into_mill, floored at 0 — dried paddy still in store. */
  driedAwaitingMillKg: number;
  /** true when the in-store figure rests on an estimated weight. */
  inStoreEstimated: boolean;
  /** Date of the first into_storage point, for FIFO. */
  inStoreSince: string | null;
  outputsKg: number;
};

export type StockOutputs = {
  headRiceKg: number;
  brokenKg: number;
  branKg: number;
  huskKg: number;
};

export type StockSnapshot = {
  /** Deliveries not yet assigned to any batch — wet paddy at intake. */
  intakeWetKg: number;
  intakeDeliveryCount: number;
  /** Sum of per-batch dried-awaiting-mill. */
  driedAwaitingMillKg: number;
  /** true when any in-store kg above rests on estimated bags. */
  driedAwaitingEstimated: boolean;
  /** Milled outputs produced across all batches (before dispatch). */
  outputs: StockOutputs;
  /** kg dispatched per output. */
  dispatched: StockOutputs;
  /** Produced minus dispatched. Negative = oversold (a data error to surface). */
  onHand: StockOutputs;
  totalOutputKg: number;
  totalDispatchedKg: number;
  totalOnHandKg: number;
  /** Recorded wastage — shown, but never counted as stock. */
  wastageKg: number;
  perBatch: BatchStockRow[];
};

const OUTPUT_STAGES = ["milled_output", "broken", "bran", "husk"] as const;

export function stockSnapshot(
  deliveries: StockDeliveryLite[],
  batches: StockBatchLite[],
  weighPoints: StockWeighLite[],
  dispatches: DispatchLite[] = [],
): StockSnapshot {
  const unassigned = deliveries.filter((d) => d.batch_id === null);
  const intakeWetKg = round2(unassigned.reduce((s, d) => s + d.gross_weight_kg, 0));

  const byBatch = new Map<string, StockWeighLite[]>();
  for (const p of weighPoints) {
    const list = byBatch.get(p.batch_id);
    if (list) list.push(p);
    else byBatch.set(p.batch_id, [p]);
  }

  const outputs: StockOutputs = { headRiceKg: 0, brokenKg: 0, branKg: 0, huskKg: 0 };
  let wastageKg = 0;
  let driedAwaitingMillKg = 0;
  let driedAwaitingEstimated = false;

  const perBatch: BatchStockRow[] = batches.map((b) => {
    const pts = byBatch.get(b.id) ?? [];
    const t = stageTotals(pts);
    const receivedKg = t.received ?? 0;
    const driedKg = t.post_drying ?? 0;
    const storedKg = t.into_storage !== undefined ? round2(t.into_storage) : null;
    const intoMillKg = t.into_mill ?? 0;
    const awaiting = round2(Math.max((storedKg ?? driedKg) - intoMillKg, 0));
    driedAwaitingMillKg = round2(driedAwaitingMillKg + awaiting);
    const inStoreStages = storedKg === null ? ["post_drying", "into_mill"] : ["into_storage", "into_mill"];
    const inStoreEstimated = pts.some((p) => p.estimated === true && inStoreStages.includes(p.stage));
    if (inStoreEstimated && awaiting > 0) driedAwaitingEstimated = true;
    const inStoreSince =
      pts
        .filter((p) => p.stage === "into_storage" && p.recorded_date)
        .map((p) => p.recorded_date as string)
        .sort()[0] ?? null;

    outputs.headRiceKg = round2(outputs.headRiceKg + (t.milled_output ?? 0));
    outputs.brokenKg = round2(outputs.brokenKg + (t.broken ?? 0));
    outputs.branKg = round2(outputs.branKg + (t.bran ?? 0));
    outputs.huskKg = round2(outputs.huskKg + (t.husk ?? 0));
    wastageKg = round2(wastageKg + (t.wastage ?? 0));

    const outputsKg = round2(
      OUTPUT_STAGES.reduce((s, stage) => s + (t[stage] ?? 0), 0),
    );

    return {
      batchId: b.id,
      batchCode: b.batch_code,
      status: b.status,
      cropType: b.crop_type,
      variety: b.variety,
      createdDate: b.created_date,
      receivedKg: round2(receivedKg),
      driedKg: round2(driedKg),
      storedKg,
      intoMillKg: round2(intoMillKg),
      driedAwaitingMillKg: awaiting,
      inStoreEstimated,
      inStoreSince,
      outputsKg,
    };
  });

  const totalOutputKg = round2(
    outputs.headRiceKg + outputs.brokenKg + outputs.branKg + outputs.huskKg,
  );

  const dp = dispatchedByProduct(dispatches);
  const dispatched: StockOutputs = {
    headRiceKg: dp.milled_output,
    brokenKg: dp.broken,
    branKg: dp.bran,
    huskKg: dp.husk,
  };
  const onHand: StockOutputs = {
    headRiceKg: round2(outputs.headRiceKg - dispatched.headRiceKg),
    brokenKg: round2(outputs.brokenKg - dispatched.brokenKg),
    branKg: round2(outputs.branKg - dispatched.branKg),
    huskKg: round2(outputs.huskKg - dispatched.huskKg),
  };
  const totalDispatchedKg = round2(
    dispatched.headRiceKg + dispatched.brokenKg + dispatched.branKg + dispatched.huskKg,
  );
  const totalOnHandKg = round2(totalOutputKg - totalDispatchedKg);

  return {
    intakeWetKg,
    intakeDeliveryCount: unassigned.length,
    driedAwaitingMillKg,
    driedAwaitingEstimated,
    outputs,
    dispatched,
    onHand,
    totalOutputKg,
    totalDispatchedKg,
    totalOnHandKg,
    wastageKg,
    perBatch,
  };
}

export type MillNextRow = BatchStockRow & { daysInStore: number | null };
export type MillNextGroup = { variety: string; rows: MillNextRow[] };

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/**
 * FIFO pick list (mill manager, 8 Sep 2026: older stock is milled first, stored by
 * variety). Groups in-store batches by variety, oldest first; groups sort by
 * variety name so the list is stable. A batch that skipped the into_storage
 * point falls back to its creation date.
 */
export function millNext(rows: BatchStockRow[], today: string): MillNextGroup[] {
  const groups = new Map<string, MillNextRow[]>();
  for (const r of rows) {
    if (r.driedAwaitingMillKg <= 0) continue;
    const key = r.variety?.trim() || "Unknown variety";
    const since = r.inStoreSince ?? r.createdDate;
    const row: MillNextRow = { ...r, daysInStore: since ? daysBetween(since, today) : null };
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.entries()]
    .map(([variety, list]) => ({
      variety,
      rows: list.sort((a, b) => {
        const da = a.inStoreSince ?? a.createdDate;
        const db = b.inStoreSince ?? b.createdDate;
        return da < db ? -1 : da > db ? 1 : a.batchCode.localeCompare(b.batchCode);
      }),
    }))
    .sort((a, b) => a.variety.localeCompare(b.variety));
}
