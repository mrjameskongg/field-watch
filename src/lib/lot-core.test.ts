import { describe, expect, it } from "vitest";
import {
  CONVERSION,
  criticalEvents,
  genealogyBack,
  genealogyForward,
  lotCode,
  massBalanceCheck,
  yieldPlausibility,
  type LotInput,
} from "./lot-core";

const input: LotInput = {
  batch: {
    id: "b1",
    batch_code: "B26-0042",
    custody_model: "identity_preserved",
    status: "milling",
    created_date: "2026-11-19",
    storage_location: "BRM warehouse KPT",
  },
  deliveries: [
    {
      id: "d1",
      delivery_code: "DL-1",
      received_date: "2026-11-18",
      gross_weight_kg: 11840,
      moisture_pct: 26,
      grade: "A",
      received_by_name: "Sokha",
      farmer: { id: "f1", full_name: "Sok Dara", farmer_code: "FRM-073349", village: "Trapeang Prei" },
      parcels: [{ farm_code: "F-1", area_hectares: 5, mapped: true }],
      contract_code: "CT-1",
    },
  ],
  weighPoints: [
    { stage: "received", weight_kg: 11840, moisture_pct: 26, recorded_date: "2026-11-18", recorded_by_name: "Sokha" },
    { stage: "post_drying", weight_kg: 9472, moisture_pct: 13.5, recorded_date: "2026-11-19", recorded_by_name: "Vanna" },
    { stage: "into_mill", weight_kg: 9472, moisture_pct: null, recorded_date: "2026-11-20", recorded_by_name: "Vanna" },
    { stage: "milled_output", weight_kg: 5872, moisture_pct: null, recorded_date: "2026-11-20", recorded_by_name: "Vanna" },
  ],
  qcTests: [{ test_type: "moisture", result_value: 13.5, passed: true, tested_date: "2026-11-19", scope: "batch" }],
};

describe("lotCode", () => {
  it("is the batch code — one traceability lot code carried by every event", () => {
    expect(lotCode(input.batch)).toBe("B26-0042");
  });
});

describe("criticalEvents", () => {
  it("emits one event per tracked step, each carrying the lot code", () => {
    const events = criticalEvents(input);
    // 1 delivery + 4 weigh points + 1 QC test.
    expect(events).toHaveLength(6);
    expect(events[0].type).toBe("harvest_receive");
    expect(events.filter((e) => e.type === "transform")).toHaveLength(3);
    expect(events.every((e) => e.lot_code === "B26-0042")).toBe(true);
  });

  it("puts an observation ahead of a transformation recorded the same day", () => {
    // The moisture test and the dryer both land on the 19th; reading the field
    // comes before changing it, so the ledger cannot imply drying was signed
    // off before it was measured.
    const sameDay = criticalEvents(input).filter((e) => e.when === "2026-11-19");
    expect(sameDay.map((e) => e.type)).toEqual(["observe", "transform"]);
  });

  it("every event answers what, when, where and who", () => {
    const first = criticalEvents(input)[0];
    expect(first.what).toContain("11,840 kg");
    expect(first.when).toBe("2026-11-18");
    expect(first.who).toBe("Sokha");
    expect(first.where).toContain("Trapeang Prei");
  });

  it("sorts by date so the ledger reads forward even when rows arrive late", () => {
    const shuffled = {
      ...input,
      weighPoints: [...input.weighPoints].reverse(),
    };
    const dates = criticalEvents(shuffled).map((e) => e.when);
    expect([...dates]).toEqual([...dates].sort());
  });

  it("works with an empty batch", () => {
    expect(criticalEvents({ ...input, deliveries: [], weighPoints: [], qcTests: [] })).toEqual([]);
  });
});

describe("genealogy", () => {
  it("back: a lot resolves to every farmer, parcel and delivery that fed it", () => {
    const g = genealogyBack(input);
    expect(g.farmers).toEqual([{ name: "Sok Dara", code: "FRM-073349", kg: 11840 }]);
    expect(g.parcels).toEqual(["F-1"]);
    expect(g.deliveries).toEqual(["DL-1"]);
    expect(g.contracts).toEqual(["CT-1"]);
  });

  it("back: sums a farmer delivering more than once, and lists each parcel once", () => {
    const twice: LotInput = {
      ...input,
      deliveries: [
        input.deliveries[0],
        { ...input.deliveries[0], id: "d2", delivery_code: "DL-2", gross_weight_kg: 2000 },
      ],
    };
    const g = genealogyBack(twice);
    expect(g.farmers).toEqual([{ name: "Sok Dara", code: "FRM-073349", kg: 13840 }]);
    expect(g.parcels).toEqual(["F-1"]);
    expect(g.deliveries).toEqual(["DL-1", "DL-2"]);
  });

  it("forward: a farmer resolves to every lot their rice reached", () => {
    const lots = genealogyForward("FRM-073349", [
      { batch_code: "B26-0042", status: "milling", farmer_codes: ["FRM-073349"] },
      { batch_code: "B26-0043", status: "shipped", farmer_codes: ["FRM-999999"] },
      { batch_code: "B26-0044", status: "stored", farmer_codes: ["FRM-073349", "FRM-999999"] },
    ]);
    expect(lots).toEqual([
      { batch_code: "B26-0042", status: "milling" },
      { batch_code: "B26-0044", status: "stored" },
    ]);
  });
});

describe("massBalanceCheck", () => {
  it("passes when milled output sits within the expected conversion of paddy in", () => {
    const r = massBalanceCheck(9472, 5872);
    expect(r.exceeded).toBe(false);
    expect(r.recoveryPct).toBeCloseTo(62, 0);
  });

  it("flags an output claim that cannot come from the recorded input", () => {
    // 80% head rice from paddy is not physically possible — the ceiling is
    // what stops a lot claiming more certified volume than it was fed.
    const r = massBalanceCheck(9472, 7600);
    expect(r.exceeded).toBe(true);
    expect(r.ceilingKg).toBeCloseTo(9472 * CONVERSION.maxMilledFraction, 0);
  });

  it("is silent when either side is missing rather than guessing", () => {
    expect(massBalanceCheck(0, 5872).exceeded).toBe(false);
    expect(massBalanceCheck(9472, 0).exceeded).toBe(false);
    expect(massBalanceCheck(9472, 0).recoveryPct).toBeNull();
  });
});

describe("yieldPlausibility", () => {
  it("accepts a normal Cambodian wet-season yield", () => {
    const r = yieldPlausibility(11840, 5);
    expect(r.implausible).toBe(false);
    expect(r.kgPerHa).toBeCloseTo(2368, 0);
  });

  it("flags volume that the mapped land could not have grown", () => {
    // Ghost volume: 60 t off 5 ha is roughly 12 t/ha, past any real yield.
    const r = yieldPlausibility(60000, 5);
    expect(r.implausible).toBe(true);
  });

  it("cannot judge without mapped hectares, and says so", () => {
    const r = yieldPlausibility(11840, null);
    expect(r.implausible).toBe(false);
    expect(r.kgPerHa).toBeNull();
    expect(r.reason).toMatch(/hectare/i);
  });
});

describe("mill flow events (mill manager, 8 Sep 2026)", () => {
  it("pre-dry is a transform, into store an observation, weigh-in names the weighbridge", () => {
    const events = criticalEvents({
      ...input,
      weighPoints: [
        { stage: "received", weight_kg: 10000, moisture_pct: 25, recorded_date: "2026-11-18", recorded_by_name: null },
        { stage: "pre_dried", weight_kg: 9000, moisture_pct: 16.5, recorded_date: "2026-11-18", recorded_by_name: null },
        { stage: "into_storage", weight_kg: 8100, moisture_pct: null, recorded_date: "2026-11-19", recorded_by_name: null },
      ],
    });
    const byLabel = (label: string) => events.find((e) => e.label === label);
    expect(byLabel("Weighed in at weighbridge")?.type).toBe("observe");
    expect(byLabel("Pre-dried, flatbed")?.type).toBe("transform");
    expect(byLabel("Into store, jumbo bags")?.type).toBe("observe");
  });
});
