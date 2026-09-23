import { describe, expect, it } from "vitest";
import {
  CUSTODY_MODELS,
  DEFAULT_CUSTODY,
  DEFAULT_KG_PER_BAG,
  MOISTURE_STAGES,
  STAGES,
  batchMath,
  estimatedWeight,
  isEstimated,
  mixesFarmers,
  stageLabel,
  stageTotals,
  varietyBlocks,
  type WeighPointLite,
} from "./batch-core";

const wp = (stage: string, weight_kg: number, moisture_pct: number | null = null): WeighPointLite => ({
  stage,
  weight_kg,
  moisture_pct,
});

describe("stageTotals", () => {
  it("sums repeated stages", () => {
    const t = stageTotals([wp("received", 500), wp("received", 300), wp("post_drying", 640)]);
    expect(t.received).toBe(800);
    expect(t.post_drying).toBe(640);
    expect(t.into_mill).toBeUndefined();
  });
  it("empty ledger", () => {
    expect(stageTotals([])).toEqual({});
  });
});

describe("batchMath", () => {
  it("drying loss measured from received vs post_drying", () => {
    const m = batchMath([wp("received", 11840, 26), wp("post_drying", 9472, 13.5)]);
    expect(m.dryingLossPct).toBeCloseTo(20.0);
    expect(m.moistureBeforeDrying).toBe(26);
    expect(m.moistureAfterDrying).toBe(13.5);
  });
  it("milling recovery and fractions of into_mill", () => {
    const m = batchMath([
      wp("into_mill", 1000),
      wp("milled_output", 620),
      wp("bran", 90),
      wp("husk", 200),
      wp("wastage", 40),
    ]);
    expect(m.millingRecoveryPct).toBeCloseTo(62);
    expect(m.branPct).toBeCloseTo(9);
    expect(m.huskPct).toBeCloseTo(20);
    expect(m.outputsExceedInput).toBe(false);
    // 620+90+200+40 = 950 -> 50 kg unaccounted
    expect(m.unaccountedKg).toBeCloseTo(50);
  });
  it("flags outputs exceeding mill input", () => {
    const m = batchMath([wp("into_mill", 1000), wp("milled_output", 700), wp("bran", 200), wp("husk", 200)]);
    expect(m.outputsExceedInput).toBe(true);
  });
  it("null metrics when stages missing", () => {
    const m = batchMath([wp("received", 500)]);
    expect(m.dryingLossPct).toBeNull();
    expect(m.millingRecoveryPct).toBeNull();
    expect(m.branPct).toBeNull();
    expect(m.outputsExceedInput).toBe(false);
    expect(m.unaccountedKg).toBeNull();
  });
  it("zero received guards division", () => {
    const m = batchMath([wp("received", 0), wp("post_drying", 0)]);
    expect(m.dryingLossPct).toBeNull();
  });
  it("moisture picks latest non-null reading per side", () => {
    const m = batchMath([wp("received", 500, null), wp("received", 300, 25), wp("post_drying", 640, null)]);
    expect(m.moistureBeforeDrying).toBe(25);
    expect(m.moistureAfterDrying).toBeNull();
  });
});

describe("mixesFarmers", () => {
  it("true when two distinct farmers", () => {
    expect(mixesFarmers(["a", "b"])).toBe(true);
  });
  it("false for one farmer repeated or empty", () => {
    expect(mixesFarmers(["a", "a"])).toBe(false);
    expect(mixesFarmers([])).toBe(false);
  });
});

describe("labels", () => {
  it("every stage has a label", () => {
    for (const s of STAGES) expect(stageLabel(s.value)).toBeTruthy();
  });
  it("unknown stage falls back to raw value", () => {
    expect(stageLabel("weird")).toBe("weird");
  });
});

describe("mill flow stages (mill manager, 8 Sep 2026)", () => {
  it("stage order follows the floor: received, pre_dried, post_drying, into_storage, into_mill", () => {
    const order = STAGES.map((s) => s.value);
    expect(order.slice(0, 5)).toEqual(["received", "pre_dried", "post_drying", "into_storage", "into_mill"]);
    expect(MOISTURE_STAGES).toEqual(["received", "pre_dried", "post_drying", "into_mill"]);
  });
  it("pre-dry moisture is reported separately from final moisture", () => {
    const m = batchMath([wp("received", 10000, 25), wp("pre_dried", 9000, 16.5), wp("post_drying", 8200, 14)]);
    expect(m.moistureAfterPreDry).toBe(16.5);
    expect(m.moistureAfterDrying).toBe(14);
    expect(m.dryingLossPct).toBeCloseTo(18);
  });
  it("estimated weight = bags × kg per bag, default 675", () => {
    expect(DEFAULT_KG_PER_BAG).toBe(675);
    expect(estimatedWeight(18, 675)).toBe(12150);
    expect(estimatedWeight(0, 675)).toBe(0);
  });
  it("stored and in-store come from into_storage minus into_mill", () => {
    const m = batchMath([
      wp("post_drying", 12000, 14),
      { ...wp("into_storage", 12150), estimated: true },
      wp("into_mill", 4000),
    ]);
    expect(m.storedKg).toBe(12150);
    expect(m.inStoreKg).toBe(8150);
    expect(m.estimatedStages).toEqual(["into_storage"]);
  });
  it("in-store is null without an into_storage point and never negative", () => {
    expect(batchMath([wp("post_drying", 100)]).inStoreKg).toBeNull();
    expect(batchMath([wp("into_storage", 100), wp("into_mill", 130)]).inStoreKg).toBe(0);
  });
  it("isEstimated says whether a figure rests on an estimate", () => {
    const m = batchMath([{ ...wp("received", 1000), estimated: true }, wp("post_drying", 800)]);
    expect(isEstimated(m, "received", "post_drying")).toBe(true);
    expect(isEstimated(m, "into_mill", "milled_output")).toBe(false);
  });
  it("variety guard blocks only when both sides are set and differ", () => {
    expect(varietyBlocks("Sen Kra Ob", "Phka Rumduol")).toBe(true);
    expect(varietyBlocks("Sen Kra Ob", "sen kra ob ")).toBe(false);
    expect(varietyBlocks(null, "Sen Kra Ob")).toBe(false);
    expect(varietyBlocks("Sen Kra Ob", null)).toBe(false);
  });
  it("mixed is the default custody, listed first", () => {
    expect(DEFAULT_CUSTODY).toBe("mass_balance");
    expect(CUSTODY_MODELS[0].value).toBe("mass_balance");
  });
});
