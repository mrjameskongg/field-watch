// Pure batch/mill math (weigh-point ledger -> measured losses). No supabase,
// no react — mirror of trade-core. Mill meeting 27 Aug 2026: drying loss and
// mill outputs must be MEASURED per batch. the mill manager's process note, 8 Sep 2026:
// a batch is one dryer run of one variety from many farmers; the flatbed may
// pre-dry before the vertical dryer; jumbo bags into store are NOT weighed
// (650-700 kg each, estimated), so any figure built on them is "about" (≈).
// Nobody weighs after the pre-cleaner, so received -> post_drying loss also
// carries the stones and sticks removed there.

import { round2 } from "./trade-core";

export type WeighPointLite = {
  stage: string;
  weight_kg: number;
  moisture_pct: number | null;
  /** true when weight_kg was estimated (bags × kg/bag), not read off a scale. */
  estimated?: boolean;
};

export const STAGES: { value: string; label: string }[] = [
  { value: "received", label: "Weighed in (weighbridge, wet)" },
  { value: "pre_dried", label: "After flatbed pre-dry" },
  { value: "post_drying", label: "After drying and cooling" },
  { value: "into_storage", label: "Into store (jumbo bags, estimated)" },
  { value: "into_mill", label: "Into mill (weighbridge)" },
  { value: "milled_output", label: "Milled output (head rice)" },
  { value: "broken", label: "Broken rice" },
  { value: "bran", label: "Rice bran" },
  { value: "husk", label: "Husk" },
  { value: "wastage", label: "Wastage" },
  { value: "other", label: "Other" },
];

/** Stages where a moisture reading is expected alongside the weight. */
export const MOISTURE_STAGES = ["received", "pre_dried", "post_drying", "into_mill"] as const;

/** Mill manager, 8 Sep 2026: jumbo bags hold roughly 650-700 kg; nobody weighs them. */
export const DEFAULT_KG_PER_BAG = 675;
export const estimatedWeight = (bagCount: number, kgPerBag: number): number =>
  round2(Math.max(0, bagCount) * Math.max(0, kgPerBag));

export const stageLabel = (stage: string): string =>
  STAGES.find((s) => s.value === stage)?.label ?? stage;

/** Total kg per stage — stages repeat (many loads through one dryer). */
export function stageTotals(points: WeighPointLite[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const p of points) totals[p.stage] = round2((totals[p.stage] ?? 0) + p.weight_kg);
  return totals;
}

const lastMoisture = (points: WeighPointLite[], stage: string): number | null => {
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (p.stage === stage && p.moisture_pct !== null && p.moisture_pct !== undefined) return p.moisture_pct;
  }
  return null;
};

export type BatchMath = {
  dryingLossPct: number | null;
  moistureBeforeDrying: number | null;
  /** Flatbed pre-dry reading, when that route was used. */
  moistureAfterPreDry: number | null;
  moistureAfterDrying: number | null;
  millingRecoveryPct: number | null;
  brokenPct: number | null;
  branPct: number | null;
  huskPct: number | null;
  wastagePct: number | null;
  /** Total put into store (jumbo bags); null when the batch went straight to the mill. */
  storedKg: number | null;
  /** into_storage minus into_mill, floored at 0; null without an into_storage point. */
  inStoreKg: number | null;
  /** into_mill minus all recorded outputs; null until both sides exist. */
  unaccountedKg: number | null;
  /** Recorded outputs sum past the mill input — a weighing error somewhere. */
  outputsExceedInput: boolean;
  /** Stages with at least one estimated point — figures built on them are "about". */
  estimatedStages: string[];
};

const pctOf = (part: number | undefined, base: number | undefined): number | null =>
  part === undefined || base === undefined || base <= 0 ? null : round2((part / base) * 100);

export function batchMath(points: WeighPointLite[]): BatchMath {
  const t = stageTotals(points);
  const outputStages = ["milled_output", "broken", "bran", "husk", "wastage"] as const;
  const recordedOutputs = outputStages.filter((s) => t[s] !== undefined);
  const outputsSum = recordedOutputs.reduce((sum, s) => sum + (t[s] ?? 0), 0);
  const hasMillInput = t.into_mill !== undefined && t.into_mill > 0;
  const estimatedStages = [...new Set(points.filter((p) => p.estimated === true).map((p) => p.stage))];
  const storedKg = t.into_storage !== undefined ? round2(t.into_storage) : null;
  return {
    dryingLossPct:
      t.received !== undefined && t.received > 0 && t.post_drying !== undefined
        ? round2(((t.received - t.post_drying) / t.received) * 100)
        : null,
    moistureBeforeDrying: lastMoisture(points, "received"),
    moistureAfterPreDry: lastMoisture(points, "pre_dried"),
    moistureAfterDrying: lastMoisture(points, "post_drying"),
    millingRecoveryPct: pctOf(t.milled_output, t.into_mill),
    brokenPct: pctOf(t.broken, t.into_mill),
    branPct: pctOf(t.bran, t.into_mill),
    huskPct: pctOf(t.husk, t.into_mill),
    wastagePct: pctOf(t.wastage, t.into_mill),
    unaccountedKg: hasMillInput && recordedOutputs.length > 0 ? round2((t.into_mill ?? 0) - outputsSum) : null,
    storedKg,
    inStoreKg: storedKg === null ? null : round2(Math.max(storedKg - (t.into_mill ?? 0), 0)),
    outputsExceedInput: hasMillInput && outputsSum > (t.into_mill ?? 0),
    estimatedStages,
  };
}

/** True when any of the given stages rests on an estimated weight. */
export const isEstimated = (math: Pick<BatchMath, "estimatedStages">, ...stages: string[]): boolean =>
  stages.some((s) => math.estimatedStages.includes(s));

const normVariety = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/** One dryer, one variety (mill manager, 8 Sep 2026). Blank on either side passes. */
export const varietyBlocks = (
  batchVariety: string | null | undefined,
  deliveryVariety: string | null | undefined,
): boolean => {
  const a = normVariety(batchVariety);
  const b = normVariety(deliveryVariety);
  return a !== "" && b !== "" && a !== b;
};

/** Identity-preserved batches must hold one farmer's rice only. */
export const mixesFarmers = (farmerIds: string[]): boolean => new Set(farmerIds).size > 1;

export const BATCH_STATUSES = ["open", "drying", "milling", "stored", "shipped", "closed"] as const;

export const DEFAULT_CUSTODY = "mass_balance";

export const CUSTODY_MODELS: { value: string; label: string; hint: string }[] = [
  {
    value: "mass_balance",
    label: "Mixed (mass balance)",
    hint: "One dryer, one variety, several farmers — the normal case (mill manager, 8 Sep 2026). Totals reconcile, no per-farm claim.",
  },
  {
    value: "identity_preserved",
    label: "Single farmer (identity preserved)",
    hint: "One farmer's paddy fills the dryer alone — the QR can name the farm.",
  },
];
