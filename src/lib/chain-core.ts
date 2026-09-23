// The farmer chain as one ordered list of steps.
//
// Process order fixed at the mill meeting, 27 Aug 2026:
//   biodata -> contract -> input -> delivery note -> tested (moisture) and PAID
//   AT THE FARM GATE -> dried and batched -> milled -> buyer.
// Payment sits before drying deliberately: the farmer is paid on the wet
// weight when the load is weighed and tested, not after the dryer.
//
// Pure: no supabase, no react. Screens pass in what they already loaded.

import { asCurrency, fmtMoney, type Currency } from "./money-core";
import { round2 } from "./trade-core";

export type ChainStepKey =
  | "biodata"
  | "contract"
  | "inputs"
  | "delivery"
  | "tested"
  | "paid"
  | "dried"
  | "milled";

/** done = happened. current = the next thing to do. pending = later. skipped = not needed here. */
export type ChainStepState = "done" | "current" | "pending" | "skipped";

export const CHAIN_STEPS: { key: ChainStepKey; title: string; waiting: string }[] = [
  { key: "biodata", title: "Farmer registered", waiting: "Register the farmer" },
  { key: "contract", title: "Contract signed", waiting: "Sign the contract" },
  { key: "inputs", title: "Inputs advanced", waiting: "Issue seed or fertiliser" },
  { key: "delivery", title: "Delivered at farm gate", waiting: "Weigh the load in" },
  { key: "tested", title: "Moisture tested", waiting: "Test moisture before paying" },
  { key: "paid", title: "Farmer paid", waiting: "Settle and pay at the gate" },
  { key: "dried", title: "Dried and batched", waiting: "Dry the paddy and put it in a batch" },
  { key: "milled", title: "Milled and shipped", waiting: "Mill the batch and ship it" },
];

export type ChainInput = {
  /** Contract currency; money in step details prints in it. Defaults to USD. */
  currency?: Currency | null;
  farmerRegisteredDate: string | null;
  farmerName: string | null;
  contractSignedDate: string | null;
  /** Contract status from the database; active or completed means the terms were agreed even if nobody typed a signed date. */
  contractStatus?: string | null;
  contractCode: string | null;
  expectedKg: number | null;
  advances: { date_issued: string; total_cost: number }[];
  deliveries: {
    id: string;
    code: string;
    received_date: string;
    gross_weight_kg: number;
    moisture_pct: number | null;
    settlement_id: string | null;
    batch_id: string | null;
  }[];
  qcTests: { delivery_id: string | null; test_type: string; tested_date: string }[];
  settlements: { settled_date: string; net_payment: number; status: string }[];
  batches: {
    id: string;
    batch_code: string;
    status: string;
    dryingLossPct: number | null;
    /** true when the loss rests on an estimated weight (bags, not a scale). */
    dryingLossEstimated: boolean;
  }[];
  /**
   * Money the viewer's role may not read (roles-core.ts). Hidden is not the
   * same as absent: the chain must not say "no advance" or "not settled"
   * about rows the database simply withheld.
   */
  hidden?: { advances?: boolean; settlements?: boolean };
};

export type ChainStep = {
  key: ChainStepKey;
  title: string;
  state: ChainStepState;
  date: string | null;
  detail: string;
};

const kg = (n: number) => `${Math.round(n).toLocaleString()} kg`;
const earliest = (dates: string[]): string | null => (dates.length ? dates.slice().sort()[0] : null);
const latest = (dates: string[]): string | null => (dates.length ? dates.slice().sort()[dates.length - 1] : null);

/** Batch statuses that mean the rice has left the mill stage behind. */
const SHIPPED_STATUSES = new Set(["shipped", "closed"]);

export function chainSteps(input: ChainInput): ChainStep[] {
  const usd = (n: number) => fmtMoney(n, asCurrency(input.currency));
  const {
    farmerRegisteredDate,
    farmerName,
    contractSignedDate,
    expectedKg,
    advances,
    deliveries,
    qcTests,
    settlements,
    batches,
  } = input;
  const hidden = input.hidden ?? {};

  const contractAgreed = input.contractStatus === "active" || input.contractStatus === "completed";
  const deliveredKg = deliveries.reduce((s, d) => s + d.gross_weight_kg, 0);
  const moistureTested = new Set(
    qcTests.filter((t) => t.test_type === "moisture" && t.delivery_id).map((t) => t.delivery_id as string),
  );
  const testedDeliveries = deliveries.filter((d) => moistureTested.has(d.id));
  const settledDeliveries = deliveries.filter((d) => d.settlement_id !== null);
  const batchedDeliveries = deliveries.filter((d) => d.batch_id !== null);
  const linkedBatches = batches.filter((b) => batchedDeliveries.some((d) => d.batch_id === b.id));
  const shippedBatches = linkedBatches.filter((b) => SHIPPED_STATUSES.has(b.status));
  const netPaid = settlements.reduce((s, x) => s + x.net_payment, 0);
  const advanceTotal = round2(advances.reduce((s, a) => s + a.total_cost, 0));

  // Each entry decides only whether its own work is finished; the "current"
  // marker is applied afterwards so exactly one step carries it.
  const raw: { key: ChainStepKey; finished: boolean; skipped?: boolean; date: string | null; detail: string }[] = [
    {
      key: "biodata",
      finished: farmerRegisteredDate !== null,
      date: farmerRegisteredDate,
      detail: farmerName ? `${farmerName} on the register` : "Farmer on the register",
    },
    {
      key: "contract",
      finished: contractSignedDate !== null || contractAgreed,
      date: contractSignedDate,
      detail: expectedKg ? `${kg(expectedKg)} expected` : "Terms agreed",
    },
    {
      key: "inputs",
      finished: advances.length > 0,
      // Only call it skipped once the contract exists: before that, nobody
      // has decided yet whether this farmer takes an advance.
      skipped: hidden.advances || (advances.length === 0 && contractSignedDate !== null),
      date: hidden.advances ? null : earliest(advances.map((a) => a.date_issued)),
      detail: hidden.advances
        ? "Office only"
        : advances.length > 0
          ? `${advances.length} advance${advances.length === 1 ? "" : "s"} · ${usd(advanceTotal)} to deduct`
          : "No advance taken",
    },
    {
      key: "delivery",
      finished: deliveries.length > 0,
      date: latest(deliveries.map((d) => d.received_date)),
      detail:
        deliveries.length > 0
          ? `${deliveries.length} load${deliveries.length === 1 ? "" : "s"} · ${kg(deliveredKg)}${
              expectedKg ? ` · ${Math.round((deliveredKg / expectedKg) * 100)}% of contract` : ""
            }`
          : "Nothing weighed in yet",
    },
    {
      key: "tested",
      finished: deliveries.length > 0 && testedDeliveries.length === deliveries.length,
      date: latest(
        qcTests.filter((t) => t.test_type === "moisture" && t.delivery_id).map((t) => t.tested_date),
      ),
      detail:
        deliveries.length === 0
          ? "Waiting on a delivery"
          : testedDeliveries.length === deliveries.length
            ? `All ${deliveries.length} load${deliveries.length === 1 ? "" : "s"} tested`
            : `${testedDeliveries.length} of ${deliveries.length} loads tested — test before paying`,
    },
    {
      key: "paid",
      // With settlements hidden, the loads' own settled mark still says whether they were paid.
      finished:
        deliveries.length > 0 &&
        settledDeliveries.length === deliveries.length &&
        (hidden.settlements || settlements.length > 0),
      date: hidden.settlements ? null : latest(settlements.map((s) => s.settled_date)),
      detail: hidden.settlements
        ? settledDeliveries.length > 0
          ? `${settledDeliveries.length} of ${deliveries.length} load(s) settled · amounts office only`
          : "Not settled yet"
        : settlements.length === 0
          ? "Not settled yet"
          : `${usd(netPaid)} net${
              settledDeliveries.length < deliveries.length
                ? ` · ${deliveries.length - settledDeliveries.length} load(s) still open`
                : ""
            }`,
    },
    {
      key: "dried",
      finished: batchedDeliveries.length > 0,
      date: null,
      detail:
        linkedBatches.length === 0
          ? "Not in a batch yet"
          : `${linkedBatches.map((b) => b.batch_code).join(", ")}${
              linkedBatches.some((b) => b.dryingLossPct !== null)
                ? ` · drying loss ${linkedBatches
                    .filter((b) => b.dryingLossPct !== null)
                    .map((b) => `${b.dryingLossEstimated ? "≈ " : ""}${b.dryingLossPct}%`)
                    .join(", ")}`
                : ""
            }`,
    },
    {
      key: "milled",
      finished: shippedBatches.length > 0,
      date: null,
      detail:
        linkedBatches.length === 0
          ? "Waiting on a batch"
          : shippedBatches.length > 0
            ? `${shippedBatches.map((b) => b.batch_code).join(", ")} shipped`
            : `In the mill · ${linkedBatches.map((b) => b.status).join(", ")}`,
    },
  ];

  let currentTaken = false;
  return raw.map((r) => {
    const meta = CHAIN_STEPS.find((s) => s.key === r.key)!;
    let state: ChainStepState;
    if (r.finished) state = "done";
    else if (r.skipped) state = "skipped";
    else if (!currentTaken) {
      state = "current";
      currentTaken = true;
    } else state = "pending";
    return {
      key: r.key,
      title: meta.title,
      state,
      date: r.finished ? r.date : null,
      detail: state === "current" ? `${meta.waiting} — ${r.detail}` : r.detail,
    };
  });
}

/** Steps behind us: finished, plus the ones that were never needed. */
export const chainProgress = (steps: ChainStep[]) => ({
  done: steps.filter((s) => s.state === "done" || s.state === "skipped").length,
  total: steps.length,
});
