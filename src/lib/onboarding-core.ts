// Operation-level version of the farmer chain: where does the WHOLE operation
// stand, computed from row counts alone. Same semantics as chain-core —
// done / skipped / current / pending, exactly one "current" — so the dashboard
// guide and the per-contract flow read identically.
//
// Pure: no supabase, no react. The dashboard passes in counts it already loads.

export type GuideCounts = {
  farmers: number;
  farmsWithGps: number;
  contracts: number;
  inputAdvances: number;
  deliveries: number;
  moistureTests: number;
  settlements: number;
  batches: number;
  shippedBatches: number;
};

export type GuideStepKey =
  | "farmers"
  | "parcels"
  | "contract"
  | "inputs"
  | "delivery"
  | "testedPaid"
  | "batched"
  | "milled";

export type GuideStepState = "done" | "current" | "pending" | "skipped";

export type GuideStep = { key: GuideStepKey; state: GuideStepState };

export function guideSteps(c: GuideCounts): GuideStep[] {
  const raw: { key: GuideStepKey; finished: boolean; skipped?: boolean }[] = [
    { key: "farmers", finished: c.farmers > 0 },
    { key: "parcels", finished: c.farmsWithGps > 0 },
    { key: "contract", finished: c.contracts > 0 },
    {
      key: "inputs",
      finished: c.inputAdvances > 0,
      // Same rule as chain-core: once a contract exists, "no advance" is a
      // decision, not an omission — before that it's simply not reached.
      skipped: c.inputAdvances === 0 && c.contracts > 0,
    },
    { key: "delivery", finished: c.deliveries > 0 },
    { key: "testedPaid", finished: c.moistureTests > 0 && c.settlements > 0 },
    { key: "batched", finished: c.batches > 0 },
    { key: "milled", finished: c.shippedBatches > 0 },
  ];

  let currentAssigned = false;
  return raw.map((s) => {
    if (s.finished) return { key: s.key, state: "done" as const };
    if (s.skipped) return { key: s.key, state: "skipped" as const };
    if (!currentAssigned) {
      currentAssigned = true;
      return { key: s.key, state: "current" as const };
    }
    return { key: s.key, state: "pending" as const };
  });
}

export const guideProgress = (steps: GuideStep[]) => ({
  done: steps.filter((s) => s.state === "done" || s.state === "skipped").length,
  total: steps.length,
});

/** Once money has moved, the operation is running — shrink the guide. */
export const collapsedByDefault = (c: GuideCounts): boolean => c.settlements >= 1;
