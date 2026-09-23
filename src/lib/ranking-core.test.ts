import { describe, expect, it } from "vitest";
import { gradeFor, rankFarmers, type RankInput } from "./ranking-core";

const farmer = (over: Partial<RankInput> = {}): RankInput => ({
  farmerId: "f1",
  name: "Test Farmer",
  expectedKg: 1000,
  deliveredKg: 0,
  totalLoads: 0,
  testedLoads: 0,
  passedLoads: 0,
  wetLoads: 0,
  activeBurnAlerts: 0,
  mapped: true,
  hasLiveContract: true,
  ...over,
});

describe("rankFarmers", () => {
  it("farmer without a live contract or expected kg is unranked, not graded D", () => {
    const { ranked, unranked } = rankFarmers([
      farmer({ farmerId: "a", hasLiveContract: false }),
      farmer({ farmerId: "b", expectedKg: 0 }),
      farmer({ farmerId: "c" }),
    ]);
    expect(ranked.map((r) => r.farmerId)).toEqual(["c"]);
    expect(unranked.map((r) => r.farmerId).sort()).toEqual(["a", "b"]);
  });

  it("perfect farmer scores 100 and grade A", () => {
    const { ranked } = rankFarmers([
      farmer({ deliveredKg: 1000, totalLoads: 2, testedLoads: 2, passedLoads: 2 }),
    ]);
    expect(ranked[0].score).toBe(100);
    expect(ranked[0].grade).toBe("A");
  });

  it("over-delivery caps fulfilment at 50 pts and sets the flag", () => {
    const { ranked } = rankFarmers([
      farmer({ deliveredKg: 1500, totalLoads: 1, testedLoads: 1, passedLoads: 1 }),
    ]);
    expect(ranked[0].fulfilmentPts).toBe(50);
    expect(ranked[0].overContract).toBe(true);
    expect(ranked[0].score).toBe(100);
  });

  it("untested loads earn zero quality credit", () => {
    const { ranked } = rankFarmers([
      farmer({ deliveredKg: 1000, totalLoads: 4, testedLoads: 2, passedLoads: 2 }),
    ]);
    // fulfilment 50 + quality 2/4*30=15 + clean 20 = 85
    expect(ranked[0].qualityPts).toBe(15);
    expect(ranked[0].score).toBe(85);
    expect(ranked[0].grade).toBe("A");
  });

  it("burn alert and unmapped farm each cost 10 clean points", () => {
    const base = { deliveredKg: 1000, totalLoads: 1, testedLoads: 1, passedLoads: 1 };
    const { ranked } = rankFarmers([
      farmer({ farmerId: "burn", ...base, activeBurnAlerts: 1 }),
      farmer({ farmerId: "unmapped", ...base, mapped: false }),
      farmer({ farmerId: "both", ...base, activeBurnAlerts: 2, mapped: false }),
    ]);
    const byId = Object.fromEntries(ranked.map((r) => [r.farmerId, r]));
    expect(byId.burn.cleanPts).toBe(10);
    expect(byId.unmapped.cleanPts).toBe(10);
    expect(byId.both.cleanPts).toBe(0);
    expect(byId.both.score).toBe(80);
  });

  it("zero deliveries = zero fulfilment and zero quality, clean still counts", () => {
    const { ranked } = rankFarmers([farmer()]);
    expect(ranked[0].score).toBe(20);
    expect(ranked[0].grade).toBe("D");
  });

  it("sorts by score desc, ties broken by delivered kg then name", () => {
    const base = { totalLoads: 1, testedLoads: 1, passedLoads: 1 };
    const { ranked } = rankFarmers([
      farmer({ farmerId: "low", name: "Aaa", deliveredKg: 500, ...base }),
      farmer({ farmerId: "tieB", name: "Bbb", deliveredKg: 1000, ...base }),
      farmer({ farmerId: "tieA", name: "Abb", deliveredKg: 1000, ...base }),
    ]);
    expect(ranked.map((r) => r.farmerId)).toEqual(["tieA", "tieB", "low"]);
  });

  it("empty input returns empty lists", () => {
    expect(rankFarmers([])).toEqual({ ranked: [], unranked: [] });
  });
});

describe("gradeFor", () => {
  it("grade edges: 85 A, 70 B, 50 C, 49 D", () => {
    expect(gradeFor(85)).toBe("A");
    expect(gradeFor(84)).toBe("B");
    expect(gradeFor(70)).toBe("B");
    expect(gradeFor(69)).toBe("C");
    expect(gradeFor(50)).toBe("C");
    expect(gradeFor(49)).toBe("D");
  });
});
