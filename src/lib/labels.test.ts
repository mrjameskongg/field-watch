import { describe, expect, it } from "vitest";
import {
  advanceItemLabel,
  alertStatusLabel,
  alertTypeLabel,
  custodyLabel,
  dispatchProductLabel,
  farmerStatusLabel,
  humanize,
  qcTestTypeLabel,
  settlementStatusLabel,
  TEST_TYPES,
} from "./labels";

describe("enum labels speak the mill's language", () => {
  it("alert types", () => {
    expect(alertTypeLabel("water_stress")).toBe("Water stress");
    expect(alertTypeLabel("possible_burn")).toBe("Possible burn");
    expect(alertTypeLabel("low_vegetation")).toBe("Low vegetation");
    expect(alertTypeLabel("manual_flag")).toBe("Flagged by officer");
  });

  it("alert status", () => {
    expect(alertStatusLabel("open")).toBe("Open");
    expect(alertStatusLabel("investigating")).toBe("Being checked");
    expect(alertStatusLabel("resolved")).toBe("Resolved");
    expect(alertStatusLabel("dismissed")).toBe("Dismissed");
  });

  it("settlement status", () => {
    expect(settlementStatusLabel("draft")).toBe("Slip saved, not paid");
    expect(settlementStatusLabel("paid")).toBe("Paid");
  });

  it("advance item types and farmer status", () => {
    expect(advanceItemLabel("seed")).toBe("Seed");
    expect(advanceItemLabel("fertiliser")).toBe("Fertiliser");
    expect(advanceItemLabel("cash")).toBe("Cash advance");
    expect(farmerStatusLabel("active")).toBe("Active");
    expect(farmerStatusLabel("inactive")).toBe("Inactive");
  });

  it("custody and dispatch products", () => {
    expect(custodyLabel("identity_preserved")).toBe("Kept separate");
    expect(custodyLabel("mass_balance")).toBe("Mixed (mass balance)");
    expect(dispatchProductLabel("head_rice")).toBe("Head rice");
    expect(dispatchProductLabel("broken")).toBe("Broken rice");
  });

  it("unknown values still read as words, never as snake_case", () => {
    expect(humanize("some_new_value")).toBe("Some new value");
    expect(alertTypeLabel("frost_risk")).toBe("Frost risk");
    expect(humanize("")).toBe("");
  });
});

describe("QC test type labels", () => {
  it("known types use the picker wording", () => {
    expect(qcTestTypeLabel("pesticide_residue")).toBe("Pesticide residue");
    expect(qcTestTypeLabel("moisture")).toBe("Moisture");
  });

  it("unknown types humanize instead of leaking snake_case", () => {
    expect(qcTestTypeLabel("aflatoxin_screen")).toBe("Aflatoxin screen");
    expect(qcTestTypeLabel(null)).toBe("");
  });
});

describe("visual QC type (mill manager, 8 Sep 2026)", () => {
  it("is offered and labelled", () => {
    expect(TEST_TYPES.map((t) => t.value)).toContain("visual");
    expect(qcTestTypeLabel("visual")).toBe("Visual check (condition, foreign matter)");
  });
});
