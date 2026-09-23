// Export grade: is a milled batch good enough for the premium market?
//
// Two numbers decide it — final paddy moisture going into the mill and the
// broken-rice share of the milled output. Thresholds and the two reference
// prices (EU vs China, USD per tonne) are operating settings, not agronomy:
// defaults here, overridable through app_settings.export_grade.

import { stageTotals, type WeighPointLite } from "./batch-core";

export type GradeRule = {
  moisture_max: number;
  broken_max_pct: number;
  eu_usd_per_t: number;
  cn_usd_per_t: number;
};

export const EXPORT_GRADE_DEFAULTS: GradeRule = {
  moisture_max: 14,
  broken_max_pct: 15,
  eu_usd_per_t: 756,
  cn_usd_per_t: 500,
};

export type ExportGrade = {
  exportGrade: boolean;
  headKg: number;
  brokenKg: number;
  /** Broken as % of (head + broken); null when nothing was milled. */
  brokenPct: number | null;
  /** Moisture of the last into_mill point, else post_drying, else null. */
  finalMoisture: number | null;
  reason: string;
};

function lastMoisture(points: WeighPointLite[], stage: string): number | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (p.stage === stage && p.moisture_pct !== null && p.moisture_pct !== undefined) return p.moisture_pct;
  }
  return null;
}

export function batchExportGrade(points: WeighPointLite[], rule: GradeRule): ExportGrade {
  const totals = stageTotals(points);
  const headKg = totals.milled_output ?? 0;
  const brokenKg = totals.broken ?? 0;
  if (headKg <= 0) {
    return { exportGrade: false, headKg: 0, brokenKg, brokenPct: null, finalMoisture: null, reason: "no milling output" };
  }
  const brokenPct = Math.round(((brokenKg / (headKg + brokenKg)) * 100 + Number.EPSILON) * 100) / 100;
  const finalMoisture = lastMoisture(points, "into_mill") ?? lastMoisture(points, "post_drying");

  if (finalMoisture === null) {
    return { exportGrade: false, headKg, brokenKg, brokenPct, finalMoisture, reason: "no moisture reading before milling" };
  }
  if (finalMoisture > rule.moisture_max) {
    return {
      exportGrade: false, headKg, brokenKg, brokenPct, finalMoisture,
      reason: `moisture ${finalMoisture} % above ${rule.moisture_max} %`,
    };
  }
  if (brokenPct > rule.broken_max_pct) {
    return {
      exportGrade: false, headKg, brokenKg, brokenPct, finalMoisture,
      reason: `broken ${brokenPct} % above ${rule.broken_max_pct} %`,
    };
  }
  return { exportGrade: true, headKg, brokenKg, brokenPct, finalMoisture, reason: "export grade" };
}

/** What the EU-over-China price gap is worth on this much head rice. */
export function premiumUnlockedUsd(headKg: number, rule: GradeRule): number {
  return Math.round(((headKg / 1000) * (rule.eu_usd_per_t - rule.cn_usd_per_t) + Number.EPSILON) * 100) / 100;
}
