import { describe, expect, it } from "vitest";
import {
  CROSS_CHECK_WINDOW_DAYS,
  agreementRate,
  buildWaterRequest,
  classifyWater,
  crossCheck,
  parseWaterStatistics,
  satelliteDrySpells,
  toDecibels,
  waterMarker,
  type CrossCheck,
  type PolygonGeo,
  type WaterReading,
  confidenceScore,
  rainContext,
} from "./water-core";

const poly: PolygonGeo = {
  type: "Polygon",
  coordinates: [[[105.0, 12.5], [105.1, 12.5], [105.1, 12.6], [105.0, 12.6], [105.0, 12.5]]],
};

const reading = (vv: number, vh = -20, date = "2026-08-14"): WaterReading => ({
  reading_date: date,
  vv_db: vv,
  vh_db: vh,
});

describe("toDecibels", () => {
  it("converts linear power to decibels", () => {
    expect(toDecibels(1)).toBe(0);
    expect(toDecibels(0.1)).toBeCloseTo(-10);
    expect(toDecibels(0.01)).toBeCloseTo(-20);
  });
  it("floors at -40 dB instead of returning -Infinity", () => {
    expect(toDecibels(0)).toBe(-40);
    expect(toDecibels(-1)).toBe(-40);
  });
});

describe("buildWaterRequest", () => {
  type WaterReq = {
    input: { data: { type: string; processing: { speckleFilter: { type: string }; backCoeff: string } }[] };
    aggregation: { timeRange: { from: string; to: string } };
  };
  it("requests Sentinel-1 GRD with speckle filtering", () => {
    const req = buildWaterRequest(poly, "2026-08-01", "2026-08-14") as unknown as WaterReq;
    expect(req.input.data[0].type).toBe("sentinel-1-grd");
    expect(req.input.data[0].processing.speckleFilter.type).toBe("LEE");
    expect(req.input.data[0].processing.backCoeff).toBe("GAMMA0_ELLIPSOID");
  });
  it("covers the full inclusive day range", () => {
    const req = buildWaterRequest(poly, "2026-08-01", "2026-08-14") as unknown as WaterReq;
    expect(req.aggregation.timeRange.from).toBe("2026-08-01T00:00:00Z");
    expect(req.aggregation.timeRange.to).toBe("2026-08-14T23:59:59Z");
  });
});

describe("parseWaterStatistics", () => {
  it("converts each pass to decibels", () => {
    const json = {
      data: [
        {
          interval: { from: "2026-08-02T00:00:00Z" },
          outputs: {
            vv: { bands: { B0: { stats: { mean: 0.01 } } } },
            vh: { bands: { B0: { stats: { mean: 0.001 } } } },
          },
        },
      ],
    };
    const out = parseWaterStatistics(json);
    expect(out).toHaveLength(1);
    expect(out[0].reading_date).toBe("2026-08-02");
    expect(out[0].vv_db).toBeCloseTo(-20, 1);
    expect(out[0].vh_db).toBeCloseTo(-30, 1);
  });
  it("drops errored and empty entries", () => {
    const json = {
      data: [
        { interval: { from: "2026-08-02T00:00:00Z" }, error: "boom" },
        { interval: { from: "2026-08-03T00:00:00Z" }, outputs: {} },
        { outputs: { vv: { bands: { B0: { stats: { mean: 0.01 } } } } } },
      ],
    };
    expect(parseWaterStatistics(json)).toEqual([]);
  });
  it("returns nothing for a malformed payload", () => {
    expect(parseWaterStatistics(null)).toEqual([]);
    expect(parseWaterStatistics({})).toEqual([]);
  });
});

describe("classifyWater", () => {
  it("calls a dark parcel flooded", () => {
    const v = classifyWater(reading(-18));
    expect(v.state).toBe("flooded");
    expect(v.confident).toBe(true);
  });
  it("trusts a flooded reading even under a closed canopy", () => {
    // Vegetation only raises backscatter, so a dark reading cannot be canopy.
    const v = classifyWater(reading(-19, -12));
    expect(v.state).toBe("flooded");
    expect(v.confident).toBe(true);
  });
  it("calls a bright parcel drained", () => {
    const v = classifyWater(reading(-8));
    expect(v.state).toBe("drained");
    expect(v.confident).toBe(true);
  });
  it("flags a drained reading under a closed canopy as unconfident", () => {
    const v = classifyWater(reading(-8, -12));
    expect(v.state).toBe("drained");
    expect(v.confident).toBe(false);
    expect(v.reason).toMatch(/canopy/i);
  });
  it("refuses to guess between the thresholds", () => {
    const v = classifyWater(reading(-12));
    expect(v.state).toBe("uncertain");
    expect(v.confident).toBe(false);
  });
});

describe("crossCheck", () => {
  const flooded = reading(-18);
  const verdict = classifyWater(flooded);

  it("agrees when the log matches the satellite", () => {
    const c = crossCheck(flooded, verdict, [
      { event_date: "2026-08-13", water_state: "flooded" },
    ]);
    expect(c.agreement).toBe("agrees");
    expect(c.gapDays).toBe(1);
  });
  it("disagrees when the log contradicts the satellite", () => {
    const c = crossCheck(flooded, verdict, [
      { event_date: "2026-08-14", water_state: "drained" },
    ]);
    expect(c.agreement).toBe("disagrees");
    expect(c.summary).toMatch(/logged drained/);
  });
  it("reports unconfirmed when nothing was logged nearby", () => {
    const c = crossCheck(flooded, verdict, [
      { event_date: "2026-06-01", water_state: "drained" },
    ]);
    expect(c.agreement).toBe("unconfirmed");
    expect(c.logged).toBeNull();
  });
  it("ignores events outside the comparison window", () => {
    const outside = { event_date: "2026-08-14", water_state: "flooded" };
    const far = { ...outside, event_date: "2026-08-01" };
    expect(Math.abs(new Date("2026-08-14").getTime() - new Date("2026-08-01").getTime()) / 86400000)
      .toBeGreaterThan(CROSS_CHECK_WINDOW_DAYS);
    const c = crossCheck(flooded, verdict, [far]);
    expect(c.agreement).toBe("unconfirmed");
  });
  it("picks the nearest event when several are in range", () => {
    const c = crossCheck(flooded, verdict, [
      { event_date: "2026-08-10", water_state: "drained" },
      { event_date: "2026-08-14", water_state: "flooded" },
    ]);
    expect(c.agreement).toBe("agrees");
    expect(c.gapDays).toBe(0);
  });
  it("is inconclusive when the satellite could not decide", () => {
    const unsure = reading(-12);
    const c = crossCheck(unsure, classifyWater(unsure), [
      { event_date: "2026-08-14", water_state: "flooded" },
    ]);
    expect(c.agreement).toBe("inconclusive");
  });
  it("ignores logged events with no water state", () => {
    const c = crossCheck(flooded, verdict, [{ event_date: "2026-08-14", water_state: null }]);
    expect(c.agreement).toBe("unconfirmed");
  });
});

describe("agreementRate", () => {
  const mk = (agreement: CrossCheck["agreement"]): CrossCheck => ({
    agreement,
    satellite: "flooded",
    logged: "flooded",
    gapDays: 1,
    summary: "",
  });
  it("scores only decisive comparisons", () => {
    expect(agreementRate([mk("agrees"), mk("agrees"), mk("disagrees"), mk("unconfirmed")])).toBe(67);
  });
  it("returns null when nothing is decisive", () => {
    expect(agreementRate([mk("unconfirmed"), mk("inconclusive")])).toBeNull();
    expect(agreementRate([])).toBeNull();
  });
});

describe("satelliteDrySpells", () => {
  it("counts each run of drained passes once", () => {
    expect(
      satelliteDrySpells([
        { state: "flooded" },
        { state: "drained" },
        { state: "drained" },
        { state: "flooded" },
        { state: "drained" },
      ]),
    ).toBe(2);
  });
  it("does not break a spell on an uncertain reading", () => {
    expect(
      satelliteDrySpells([{ state: "drained" }, { state: "uncertain" }, { state: "drained" }]),
    ).toBe(1);
  });
  it("counts nothing when the field never dried", () => {
    expect(satelliteDrySpells([{ state: "flooded" }, { state: "flooded" }])).toBe(0);
  });
});

describe("waterMarker", () => {
  it("is stable per parcel and date", () => {
    expect(waterMarker("abc", "2026-08-14")).toBe("[S1 abc 2026-08-14]");
  });
});

describe("confidenceScore", () => {
  it("gives full confidence 3 dB clear of the drained threshold", () => {
    const c = confidenceScore({ reading_date: "2026-08-20", vv_db: -7, vh_db: -20 });
    expect(c.score).toBe(1);
    expect(c.grade).toBe("high");
  });

  it("gives full confidence 3 dB below the flooded threshold", () => {
    const c = confidenceScore({ reading_date: "2026-08-20", vv_db: -18, vh_db: -22 });
    expect(c.score).toBe(1);
    expect(c.grade).toBe("high");
  });

  it("scores a marginal drained call low", () => {
    const c = confidenceScore({ reading_date: "2026-08-20", vv_db: -9.8, vh_db: -20 });
    expect(c.score).toBeLessThan(0.34);
    expect(c.grade).toBe("low");
  });

  it("caps canopy-masked drained readings into the low grade regardless of margin", () => {
    const c = confidenceScore({ reading_date: "2026-08-20", vv_db: -5, vh_db: -15 });
    expect(c.score).toBeLessThanOrEqual(0.3);
    expect(c.grade).toBe("low");
  });

  it("does NOT cap flooded readings under canopy — dark VV is water", () => {
    const c = confidenceScore({ reading_date: "2026-08-20", vv_db: -19, vh_db: -15 });
    expect(c.score).toBe(1);
  });

  it("marks the uncertain band low", () => {
    const c = confidenceScore({ reading_date: "2026-08-20", vv_db: -12.5, vh_db: -20 });
    expect(c.score).toBe(0.2);
    expect(c.grade).toBe("low");
  });
});

describe("rainContext", () => {
  const rain = { "2026-08-18": 0, "2026-08-19": 1.2, "2026-08-20": 2.1 };

  it("labels a dry-spell drained call as managed drying", () => {
    const r = rainContext("2026-08-20", "drained", rain);
    expect(r.label).toBe("managed_dry");
    expect(r.rain72h).toBe(3.3);
  });

  it("labels flooded after heavy rain as possibly weather", () => {
    const r = rainContext("2026-08-20", "flooded", { "2026-08-19": 35, "2026-08-20": 4, "2026-08-18": 0 });
    expect(r.label).toBe("rain_possible");
    expect(r.rain72h).toBe(39);
  });

  it("drained with moderate recent rain stays neutral", () => {
    const r = rainContext("2026-08-20", "drained", { "2026-08-20": 12, "2026-08-19": 0, "2026-08-18": 0 });
    expect(r.label).toBe("neutral");
  });

  it("returns no_data when no rainfall record covers the window", () => {
    const r = rainContext("2026-08-20", "drained", {});
    expect(r.label).toBe("no_data");
    expect(r.rain72h).toBeNull();
  });

  it("refuses a decisive label on partial rain coverage", () => {
    const r = rainContext("2026-08-20", "drained", { "2026-08-20": 0 });
    expect(r.label).toBe("neutral"); // 0 mm but only 1 of 3 days covered
    expect(r.rain72h).toBe(0);
  });

  it("sums exactly the pass day and two prior days", () => {
    const r = rainContext("2026-08-20", "drained", {
      "2026-08-17": 99, // outside window — ignored
      "2026-08-18": 1,
      "2026-08-19": 1,
      "2026-08-20": 1,
      "2026-08-21": 99, // after the pass — ignored
    });
    expect(r.rain72h).toBe(3);
  });
});
