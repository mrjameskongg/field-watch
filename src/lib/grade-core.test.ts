import { describe, expect, it } from "vitest";
import { EXPORT_GRADE_DEFAULTS, batchExportGrade, premiumUnlockedUsd } from "./grade-core";

const seed = (intoMillMoisture: number, broken = 2050) => [
  { stage: "received", weight_kg: 22830, moisture_pct: 22.8 },
  { stage: "post_drying", weight_kg: 18400, moisture_pct: 14.2 },
  { stage: "into_mill", weight_kg: 18400, moisture_pct: intoMillMoisture },
  { stage: "milled_output", weight_kg: 11450, moisture_pct: null },
  { stage: "broken", weight_kg: broken, moisture_pct: null },
  { stage: "bran", weight_kg: 1570, moisture_pct: null },
  { stage: "husk", weight_kg: 3100, moisture_pct: null },
];

describe("batchExportGrade", () => {
  it("fails the seed batch on moisture 14.2 % above the 14 % ceiling", () => {
    const g = batchExportGrade(seed(14.2), EXPORT_GRADE_DEFAULTS);
    expect(g.exportGrade).toBe(false);
    expect(g.finalMoisture).toBe(14.2);
    expect(g.headKg).toBe(11450);
    expect(g.reason).toContain("14.2");
  });
  it("passes at 13.8 % moisture with broken 15.19 % just over the line → fails on broken", () => {
    const g = batchExportGrade(seed(13.8), EXPORT_GRADE_DEFAULTS);
    expect(g.brokenPct).toBeCloseTo(15.19, 2);
    expect(g.exportGrade).toBe(false);
    expect(g.reason).toContain("broken");
  });
  it("passes when both moisture and broken are within limits", () => {
    const g = batchExportGrade(seed(13.8, 1500), EXPORT_GRADE_DEFAULTS);
    expect(g.exportGrade).toBe(true);
    expect(g.reason).toBe("export grade");
  });
  it("uses post_drying moisture when into_mill carries none", () => {
    const pts = seed(13.8, 1500).map((p) => (p.stage === "into_mill" ? { ...p, moisture_pct: null } : p));
    expect(batchExportGrade(pts, EXPORT_GRADE_DEFAULTS).finalMoisture).toBe(14.2);
  });
  it("is not export grade with no milling output", () => {
    const g = batchExportGrade([], EXPORT_GRADE_DEFAULTS);
    expect(g.exportGrade).toBe(false);
    expect(g.headKg).toBe(0);
    expect(g.reason).toBe("no milling output");
  });
});

describe("premiumUnlockedUsd", () => {
  it("prices the EU-over-China gap per tonne of head rice", () => {
    expect(premiumUnlockedUsd(11450, EXPORT_GRADE_DEFAULTS)).toBeCloseTo(2931.2, 1);
    expect(premiumUnlockedUsd(0, EXPORT_GRADE_DEFAULTS)).toBe(0);
  });
});
