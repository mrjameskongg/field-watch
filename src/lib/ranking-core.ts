// Farmer ranking: "compare deliveries to the estimate — that's how we rank
// our farmers" (James), made transparent.
//
//   Fulfilment  50 pts  delivered vs contracted estimate, capped at 100%
//   Quality     30 pts  loads that PASSED a moisture test / all loads
//                       (untested load = 0 credit, deliberately)
//   Clean       20 pts  10 no active burn alert + 10 farm mapped
//
// Farmers without a live contract or an estimate are unranked — a farmer
// who hasn't signed yet is not a D-grade farmer, just not measurable.
//
// Pure: no supabase, no react.

export type RankInput = {
  farmerId: string;
  name: string;
  expectedKg: number;
  deliveredKg: number;
  totalLoads: number;
  testedLoads: number;
  passedLoads: number;
  /** moisture_flagged loads (>24%) — display only, already punished via the failed test */
  wetLoads: number;
  activeBurnAlerts: number;
  mapped: boolean;
  hasLiveContract: boolean;
};

export type Grade = "A" | "B" | "C" | "D";

export type RankedFarmer = RankInput & {
  fulfilmentPts: number;
  qualityPts: number;
  cleanPts: number;
  score: number;
  grade: Grade;
  overContract: boolean;
  fulfilmentPct: number;
};

export const gradeFor = (score: number): Grade =>
  score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : "D";

export function rankFarmers(inputs: RankInput[]): {
  ranked: RankedFarmer[];
  unranked: RankInput[];
} {
  const eligible = inputs.filter((f) => f.hasLiveContract && f.expectedKg > 0);
  const unranked = inputs.filter((f) => !f.hasLiveContract || f.expectedKg <= 0);

  const ranked = eligible
    .map((f) => {
      const ratio = f.deliveredKg / f.expectedKg;
      const fulfilmentPts = Math.min(ratio, 1) * 50;
      const qualityPts = f.totalLoads > 0 ? (f.passedLoads / f.totalLoads) * 30 : 0;
      const cleanPts = (f.activeBurnAlerts === 0 ? 10 : 0) + (f.mapped ? 10 : 0);
      const score = Math.round(fulfilmentPts + qualityPts + cleanPts);
      return {
        ...f,
        fulfilmentPts: Math.round(fulfilmentPts),
        qualityPts: Math.round(qualityPts),
        cleanPts,
        score,
        grade: gradeFor(score),
        overContract: ratio > 1,
        fulfilmentPct: Math.round(ratio * 100),
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.deliveredKg - a.deliveredKg ||
        a.name.localeCompare(b.name),
    );

  return { ranked, unranked };
}
