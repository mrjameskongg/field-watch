// Lot traceability: the batch as a traceability lot, its critical tracking
// events, its genealogy in both directions, and the two reconciliation checks
// that catch a lot claiming more than it was fed.
//
// Shape borrowed from the standards buyers audit against — GS1 EPCIS and the
// FDA's Food Traceability Rule both work as *critical tracking events* (the
// moments a lot is created, transformed, observed or shipped), each carrying
// *key data elements* (what, when, where, who) and all tied to one
// *traceability lot code*. One-up/one-down is the regulatory floor: the ceiling
// is being able to answer, for any lot, every farm that fed it and every lot a
// farm reached — and to answer immediately rather than within the 24 hours the
// rule allows.
//
// Events are derived from the records already stored, not written to a second
// table, so the ledger cannot drift out of step with the rows it describes.

import { qcTestTypeLabel } from "@/lib/labels";

export type CustodyModel = string;

export type LotInput = {
  batch: {
    id: string;
    batch_code: string;
    custody_model: CustodyModel;
    status: string;
    created_date: string;
    storage_location: string | null;
  };
  deliveries: {
    id: string;
    delivery_code: string;
    received_date: string;
    gross_weight_kg: number;
    moisture_pct: number | null;
    grade: string | null;
    received_by_name: string | null;
    farmer: { id: string; full_name: string; farmer_code: string; village: string | null } | null;
    parcels: { farm_code: string; area_hectares: number | null; mapped: boolean }[];
    contract_code: string | null;
  }[];
  weighPoints: {
    stage: string;
    weight_kg: number;
    moisture_pct: number | null;
    recorded_date: string;
    recorded_by_name: string | null;
  }[];
  qcTests: {
    test_type: string;
    result_value: number | null;
    passed: boolean | null;
    tested_date: string;
    scope: "batch" | "delivery";
  }[];
};

/** Event kinds, named the way an auditor's checklist names them. */
export type EventType = "harvest_receive" | "transform" | "observe" | "aggregate" | "ship";

export type CriticalEvent = {
  type: EventType;
  label: string;
  lot_code: string;
  /** Key data elements. */
  what: string;
  when: string;
  where: string;
  who: string;
};

/** One traceability lot code per batch, carried by every event about it. */
export const lotCode = (batch: LotInput["batch"]): string => batch.batch_code;

const kg = (n: number) => `${Math.round(n).toLocaleString()} kg`;

const STAGE_EVENT: Record<string, { type: EventType; label: string }> = {
  received: { type: "observe", label: "Weighed in at weighbridge" },
  pre_dried: { type: "transform", label: "Pre-dried, flatbed" },
  post_drying: { type: "transform", label: "Dried" },
  into_storage: { type: "observe", label: "Into store, jumbo bags" },
  into_mill: { type: "transform", label: "Into mill" },
  milled_output: { type: "transform", label: "Milled — head rice" },
  broken: { type: "transform", label: "Milled — broken rice" },
  bran: { type: "transform", label: "Milled — bran" },
  husk: { type: "transform", label: "Milled — husk" },
  wastage: { type: "transform", label: "Wastage" },
  other: { type: "observe", label: "Other weighing" },
};

export function criticalEvents(input: LotInput): CriticalEvent[] {
  const code = lotCode(input.batch);
  const where = input.batch.storage_location ?? "BRM";

  const events: CriticalEvent[] = [
    ...input.deliveries.map((d) => ({
      type: "harvest_receive" as EventType,
      label: `Harvest received — ${d.delivery_code}`,
      lot_code: code,
      what: [kg(d.gross_weight_kg), d.grade ? `grade ${d.grade}` : null, d.moisture_pct !== null ? `${d.moisture_pct}% moisture` : null]
        .filter(Boolean)
        .join(" · "),
      when: d.received_date,
      where: [d.farmer?.village, d.parcels.map((p) => p.farm_code).join(", ")].filter(Boolean).join(" · ") || "Farm gate",
      who: d.received_by_name ?? d.farmer?.full_name ?? "—",
    })),
    ...input.weighPoints.map((w) => {
      const meta = STAGE_EVENT[w.stage] ?? { type: "observe" as EventType, label: w.stage };
      return {
        type: meta.type,
        label: meta.label,
        lot_code: code,
        what: [kg(w.weight_kg), w.moisture_pct !== null ? `${w.moisture_pct}% moisture` : null].filter(Boolean).join(" · "),
        when: w.recorded_date,
        where,
        who: w.recorded_by_name ?? "—",
      };
    }),
    ...input.qcTests.map((q) => ({
      type: "observe" as EventType,
      label: `Quality test — ${qcTestTypeLabel(q.test_type)}`,
      lot_code: code,
      what: [
        q.result_value !== null ? String(q.result_value) : null,
        q.passed === null ? "pending" : q.passed ? "pass" : "fail",
      ]
        .filter(Boolean)
        .join(" · "),
      when: q.tested_date,
      where,
      who: "Quality",
    })),
  ];

  // Stable order: by date, and within a date keep intake ahead of processing.
  const rank: Record<EventType, number> = { harvest_receive: 0, observe: 1, transform: 2, aggregate: 3, ship: 4 };
  return events.sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : rank[a.type] - rank[b.type]));
}

export type Genealogy = {
  farmers: { name: string; code: string; kg: number }[];
  parcels: string[];
  deliveries: string[];
  contracts: string[];
};

/** One step back, and every step back: everything that fed this lot. */
export function genealogyBack(input: LotInput): Genealogy {
  const byFarmer = new Map<string, { name: string; code: string; kg: number }>();
  const parcels = new Set<string>();
  const contracts = new Set<string>();
  const deliveries: string[] = [];

  for (const d of input.deliveries) {
    deliveries.push(d.delivery_code);
    if (d.contract_code) contracts.add(d.contract_code);
    for (const p of d.parcels) parcels.add(p.farm_code);
    if (d.farmer) {
      const prev = byFarmer.get(d.farmer.farmer_code);
      byFarmer.set(d.farmer.farmer_code, {
        name: d.farmer.full_name,
        code: d.farmer.farmer_code,
        kg: (prev?.kg ?? 0) + d.gross_weight_kg,
      });
    }
  }

  return {
    farmers: [...byFarmer.values()],
    parcels: [...parcels].sort(),
    deliveries: deliveries.sort(),
    contracts: [...contracts].sort(),
  };
}

/** One step forward: every lot a farmer's rice reached. */
export function genealogyForward(
  farmerCode: string,
  lots: { batch_code: string; status: string; farmer_codes: string[] }[],
): { batch_code: string; status: string }[] {
  return lots
    .filter((l) => l.farmer_codes.includes(farmerCode))
    .map((l) => ({ batch_code: l.batch_code, status: l.status }));
}

/**
 * Conversion ceilings for paddy. Milling recovery for good paddy runs roughly
 * 60-70% head rice; nothing physically reaches 75%. The ceiling is deliberately
 * generous — its job is to catch impossible claims, not to police good ones.
 */
export const CONVERSION = { maxMilledFraction: 0.75 };

export type MassBalance = {
  recoveryPct: number | null;
  ceilingKg: number | null;
  exceeded: boolean;
};

/** Mass balance: an output claim may never exceed what the input could yield. */
export function massBalanceCheck(intoMillKg: number, milledOutputKg: number): MassBalance {
  if (intoMillKg <= 0 || milledOutputKg <= 0) {
    return { recoveryPct: null, ceilingKg: intoMillKg > 0 ? intoMillKg * CONVERSION.maxMilledFraction : null, exceeded: false };
  }
  const ceilingKg = intoMillKg * CONVERSION.maxMilledFraction;
  return {
    recoveryPct: Math.round((milledOutputKg / intoMillKg) * 1000) / 10,
    ceilingKg,
    exceeded: milledOutputKg > ceilingKg,
  };
}

/**
 * Yield plausibility — the "scope mismatch" check auditors use: does the volume
 * delivered actually fit the land it is claimed to come from? Cambodian paddy
 * runs roughly 2-4 t/ha wet season; 10 t/ha is beyond any real field, so volume
 * past that ceiling means either unmapped land or rice bought in from elsewhere.
 */
export const MAX_PADDY_KG_PER_HA = 10000;

export type YieldCheck = { kgPerHa: number | null; implausible: boolean; reason: string | null };

export function yieldPlausibility(deliveredKg: number, hectares: number | null): YieldCheck {
  if (!hectares || hectares <= 0) {
    return { kgPerHa: null, implausible: false, reason: "No mapped hectares — cannot check volume against land" };
  }
  const kgPerHa = deliveredKg / hectares;
  return {
    kgPerHa,
    implausible: kgPerHa > MAX_PADDY_KG_PER_HA,
    reason:
      kgPerHa > MAX_PADDY_KG_PER_HA
        ? `${Math.round(kgPerHa).toLocaleString()} kg/ha is beyond any real paddy yield — check for unmapped land or rice bought in`
        : null,
  };
}
