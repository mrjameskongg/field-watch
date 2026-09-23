// Zone-level aggregates for the map's overview band — pure functions, tested.
// "Monitored" means the parcel can actually be watched: it has a boundary
// (satellite health + polygon fire matching) or at least a GPS point
// (proximity fire matching only).

import { isStressed, latestByFarm, type HealthRow } from "./health-core";

export interface ZoneFarm {
  id: string;
  area_hectares: number | null;
  latitude: number | null;
  longitude: number | null;
  boundary_geojson: unknown | null;
}

export interface ZoneStats {
  parcelsMonitored: number;
  hectares: number;
  healthy: number;
  stressed: number;
  noReading: number;
  drySpells: number;
  fires30d: number;
}

export function isMonitored(f: ZoneFarm): boolean {
  return !!f.boundary_geojson || (f.latitude != null && f.longitude != null);
}

export function zoneStats(input: {
  farms: ZoneFarm[];
  health: HealthRow[];
  drySpellEvents: number;
  fireAlerts30d: number;
}): ZoneStats {
  const monitored = input.farms.filter(isMonitored);
  const latest = latestByFarm(input.health);

  let healthy = 0;
  let stressed = 0;
  let noReading = 0;
  for (const f of monitored) {
    const r = latest.get(f.id);
    if (!r) noReading++;
    else if (isStressed(r.ndvi_mean)) stressed++;
    else healthy++;
  }

  const hectares =
    Math.round(monitored.reduce((sum, f) => sum + (f.area_hectares ?? 0), 0) * 100) / 100;

  return {
    parcelsMonitored: monitored.length,
    hectares,
    healthy,
    stressed,
    noReading,
    drySpells: input.drySpellEvents,
    fires30d: input.fireAlerts30d,
  };
}
