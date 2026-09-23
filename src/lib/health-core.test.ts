import { describe, expect, it } from "vitest";
import {
  addDays,
  buildStatisticsRequest,
  daysBetween,
  isCleanPass,
  parseStatistics,
  type PolygonGeo,
} from "./health-core";

const square: PolygonGeo = {
  type: "Polygon",
  coordinates: [[
    [105.01, 12.58],
    [105.0192, 12.58],
    [105.0192, 12.589],
    [105.01, 12.589],
    [105.01, 12.58],
  ]],
};

// Shape copied from the Sentinel Hub Statistical API docs: outputs is keyed by
// output id, bands by band name ("B0"), stats holds the mean.
function statsResponse(
  from: string,
  values: { ndvi: number; ndmi: number; clear: number },
) {
  const band = (mean: number) => ({ bands: { B0: { stats: { mean, sampleCount: 1000, noDataCount: 100 } } } });
  return {
    data: [
      {
        interval: { from: `${from}T00:00:00Z`, to: `${from}T23:59:59Z` },
        outputs: {
          ndvi: band(values.ndvi),
          ndmi: band(values.ndmi),
          clear: band(values.clear),
        },
      },
    ],
    status: "OK",
  };
}

describe("buildStatisticsRequest", () => {
  const req = buildStatisticsRequest(square, "2026-07-01", "2026-07-31") as {
    input: { bounds: { geometry: PolygonGeo; properties: { crs: string } }; data: { type: string }[] };
    aggregation: { timeRange: { from: string; to: string }; aggregationInterval: { of: string }; evalscript: string; resx: number; resy: number };
    calculations: Record<string, unknown>;
  };

  it("sends the parcel polygon in WGS84", () => {
    expect(req.input.bounds.geometry).toEqual(square);
    expect(req.input.bounds.properties.crs).toBe("http://www.opengis.net/def/crs/OGC/1.3/CRS84");
  });
  it("asks for Sentinel-2 L2A at 10 m, one interval per day", () => {
    expect(req.input.data[0].type).toBe("sentinel-2-l2a");
    expect(req.aggregation.resx).toBe(10);
    expect(req.aggregation.resy).toBe(10);
    expect(req.aggregation.aggregationInterval.of).toBe("P1D");
  });
  it("passes the date range as full-day UTC bounds", () => {
    expect(req.aggregation.timeRange.from).toBe("2026-07-01T00:00:00Z");
    expect(req.aggregation.timeRange.to).toBe("2026-07-31T23:59:59Z");
  });
  it("uses an evalscript that masks clouds via SCL and returns dataMask", () => {
    expect(req.aggregation.evalscript).toContain("SCL");
    expect(req.aggregation.evalscript).toContain("dataMask");
  });
});

describe("parseStatistics", () => {
  it("divides the masked means by the clear fraction", () => {
    // 80% clear: stored means must be 0.48/0.8 = 0.6 and 0.16/0.8 = 0.2.
    const [r] = parseStatistics(statsResponse("2026-07-04", { ndvi: 0.48, ndmi: 0.16, clear: 0.8 }));
    expect(r.reading_date).toBe("2026-07-04");
    expect(r.ndvi_mean).toBeCloseTo(0.6, 4);
    expect(r.ndmi_mean).toBeCloseTo(0.2, 4);
    expect(r.cloud_pct).toBeCloseTo(20, 2);
  });
  it("skips a fully clouded pass instead of dividing by zero", () => {
    expect(parseStatistics(statsResponse("2026-07-09", { ndvi: 0, ndmi: 0, clear: 0 }))).toEqual([]);
  });
  it("skips intervals the API returned an error for", () => {
    const json = { data: [{ interval: { from: "2026-07-11T00:00:00Z" }, error: { type: "BAD_REQUEST" } }] };
    expect(parseStatistics(json)).toEqual([]);
  });
  it("returns [] for junk", () => {
    expect(parseStatistics(null)).toEqual([]);
    expect(parseStatistics({})).toEqual([]);
    expect(parseStatistics({ data: "nope" })).toEqual([]);
  });
});

describe("isCleanPass", () => {
  const at = (cloud_pct: number) => ({
    reading_date: "2026-07-30",
    ndvi_mean: 0.5,
    ndmi_mean: 0.2,
    cloud_pct,
  });
  it("accepts a pass just under the cloud gate", () => {
    expect(isCleanPass(at(39.9))).toBe(true);
  });
  it("accepts a pass exactly at the cloud gate", () => {
    expect(isCleanPass(at(40))).toBe(true);
  });
  it("rejects a pass just over the cloud gate", () => {
    expect(isCleanPass(at(40.1))).toBe(false);
  });
});

describe("date helpers", () => {
  it("adds and subtracts days across a month boundary", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-08-01", -32)).toBe("2026-06-30");
  });
  it("counts whole days between dates", () => {
    expect(daysBetween("2026-07-01", "2026-07-31")).toBe(30);
    expect(daysBetween("2026-07-31", "2026-07-01")).toBe(-30);
  });
});

import {
  evaluateThresholds,
  healthColor,
  healthMarker,
  isStressed,
  latestByFarm,
  stressedCount,
  vegetationLabel,
  waterLabel,
  type HealthRow,
} from "./health-core";

const reading = (date: string, ndvi: number, ndmi: number) => ({
  reading_date: date,
  ndvi_mean: ndvi,
  ndmi_mean: ndmi,
  cloud_pct: 5,
});

describe("evaluateThresholds", () => {
  it("flags a real drop against the last 30 days", () => {
    const alerts = evaluateThresholds(
      "farm-1",
      "Parcel F",
      reading("2026-07-30", 0.4, 0.3),
      [reading("2026-07-10", 0.7, 0.3), reading("2026-07-20", 0.7, 0.3)],
    );
    const veg = alerts.find((a) => a.alert_type === "low_vegetation");
    expect(veg?.severity).toBe("high"); // 0.4 vs 0.7 baseline = 43% drop
    expect(veg?.description).toContain("Parcel F");
    expect(veg?.description).toContain("[S2 farm-1 2026-07-30 low_vegetation]");
  });
  it("calls a smaller drop medium", () => {
    const [veg] = evaluateThresholds("farm-1", "Parcel F", reading("2026-07-30", 0.44, 0.3), [
      reading("2026-07-20", 0.6, 0.3),
    ]);
    expect(veg.severity).toBe("medium"); // 27% drop
  });
  it("does not flag a drop that is still healthy in absolute terms", () => {
    const alerts = evaluateThresholds("farm-1", "Parcel F", reading("2026-07-30", 0.62, 0.3), [
      reading("2026-07-20", 0.85, 0.3),
    ]);
    expect(alerts).toEqual([]); // 27% drop but 0.62 >= 0.5 floor
  });
  it("does not flag a parcel that is low but not declining", () => {
    // 0.28 is under the 0.5 floor, but it is 93% of the 0.3 baseline — no drop.
    const alerts = evaluateThresholds("farm-1", "Parcel F", reading("2026-07-30", 0.28, 0.3), [
      reading("2026-07-20", 0.3, 0.3),
    ]);
    expect(alerts).toEqual([]);
  });
  it("ignores baseline readings older than 30 days", () => {
    const alerts = evaluateThresholds("farm-1", "Parcel F", reading("2026-07-30", 0.3, 0.3), [
      reading("2026-05-01", 0.9, 0.3),
    ]);
    expect(alerts).toEqual([]);
  });
  it("raises nothing on the very first reading", () => {
    expect(evaluateThresholds("farm-1", "Parcel F", reading("2026-07-30", 0.2, 0.3), [])).toEqual([]);
  });
  it("flags water stress with no baseline at all", () => {
    const [water] = evaluateThresholds("farm-1", "Parcel F", reading("2026-07-30", 0.7, 0.12), []);
    expect(water.alert_type).toBe("water_stress");
    expect(water.severity).toBe("medium");
  });
  it("calls very dry parcels high severity", () => {
    const [water] = evaluateThresholds("farm-1", "Parcel F", reading("2026-07-30", 0.7, 0.02), []);
    expect(water.severity).toBe("high");
  });
  it("stays silent when water is fine", () => {
    expect(evaluateThresholds("farm-1", "Parcel F", reading("2026-07-30", 0.7, 0.25), [])).toEqual([]);
  });
});

describe("healthMarker", () => {
  it("builds the dedupe marker", () => {
    expect(healthMarker("farm-1", "2026-07-30", "water_stress")).toBe("[S2 farm-1 2026-07-30 water_stress]");
  });
});

describe("labels and colours", () => {
  it("words for vegetation", () => {
    expect(vegetationLabel(0.7)).toBe("healthy");
    expect(vegetationLabel(0.5)).toBe("moderate");
    expect(vegetationLabel(0.2)).toBe("poor");
  });
  it("words for water", () => {
    expect(waterLabel(0.3)).toBe("adequate");
    expect(waterLabel(0.1)).toBe("low");
    expect(waterLabel(0.01)).toBe("stressed");
  });
  it("colours by NDVI band, grey when unknown", () => {
    expect(healthColor(0.7)).toBe("#16a34a");
    expect(healthColor(0.5)).toBe("#eab308");
    expect(healthColor(0.2)).toBe("#dc2626");
    expect(healthColor(null)).toBe("#94a3b8");
    expect(healthColor(undefined)).toBe("#94a3b8");
  });
  it("counts yellow and red as stressed", () => {
    expect(isStressed(0.7)).toBe(false);
    expect(isStressed(0.59)).toBe(true);
  });
});

describe("latestByFarm", () => {
  const rows: HealthRow[] = [
    { farm_id: "a", ...reading("2026-07-20", 0.7, 0.3) },
    { farm_id: "a", ...reading("2026-07-30", 0.3, 0.3) },
    { farm_id: "b", ...reading("2026-07-25", 0.8, 0.3) },
  ];
  it("keeps the newest row per parcel regardless of input order", () => {
    const latest = latestByFarm(rows);
    expect(latest.get("a")?.reading_date).toBe("2026-07-30");
    expect(latest.get("b")?.reading_date).toBe("2026-07-25");
  });
  it("counts parcels whose latest reading is yellow or red", () => {
    expect(stressedCount(rows)).toBe(1);
  });
});
