import { describe, expect, it } from "vitest";
import { isMonitored, zoneStats, type ZoneFarm } from "./zone-stats";
import type { HealthRow } from "./health-core";

const farm = (partial: Partial<ZoneFarm>): ZoneFarm => ({
  id: "f1",
  area_hectares: null,
  latitude: null,
  longitude: null,
  boundary_geojson: null,
  ...partial,
});

const reading = (farmId: string, ndvi: number, date = "2026-08-10"): HealthRow => ({
  farm_id: farmId,
  reading_date: date,
  ndvi_mean: ndvi,
  ndmi_mean: 0,
  cloud_pct: 0,
});

describe("isMonitored", () => {
  it("counts a boundary or a GPS point, not a bare record", () => {
    expect(isMonitored(farm({ boundary_geojson: { type: "Polygon" } }))).toBe(true);
    expect(isMonitored(farm({ latitude: 12.5, longitude: 105.0 }))).toBe(true);
    expect(isMonitored(farm({}))).toBe(false);
    expect(isMonitored(farm({ latitude: 12.5 }))).toBe(false);
  });
});

describe("zoneStats", () => {
  it("aggregates hectares and health split over monitored parcels only", () => {
    const farms = [
      farm({ id: "a", boundary_geojson: {}, area_hectares: 100 }),
      farm({ id: "b", latitude: 12.5, longitude: 105, area_hectares: 22.5 }),
      farm({ id: "c", area_hectares: 999 }), // unmonitored — excluded entirely
    ];
    const health = [reading("a", 0.7), reading("b", 0.3)];
    const s = zoneStats({ farms, health, drySpellEvents: 4, fireAlerts30d: 2 });
    expect(s.parcelsMonitored).toBe(2);
    expect(s.hectares).toBe(122.5);
    expect(s.healthy).toBe(1);
    expect(s.stressed).toBe(1);
    expect(s.noReading).toBe(0);
    expect(s.drySpells).toBe(4);
    expect(s.fires30d).toBe(2);
  });

  it("uses only the newest reading per parcel", () => {
    const farms = [farm({ id: "a", boundary_geojson: {} })];
    const health = [reading("a", 0.2, "2026-07-01"), reading("a", 0.8, "2026-08-01")];
    const s = zoneStats({ farms, health, drySpellEvents: 0, fireAlerts30d: 0 });
    expect(s.healthy).toBe(1);
    expect(s.stressed).toBe(0);
  });

  it("counts parcels without readings separately", () => {
    const farms = [farm({ id: "a", boundary_geojson: {} }), farm({ id: "b", latitude: 1, longitude: 2 })];
    const s = zoneStats({ farms, health: [], drySpellEvents: 0, fireAlerts30d: 0 });
    expect(s.noReading).toBe(2);
    expect(s.healthy + s.stressed).toBe(0);
  });
});
