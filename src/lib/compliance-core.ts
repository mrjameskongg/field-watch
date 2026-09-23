// Evidence packs: the origin record a buyer's due-diligence team or a carbon
// verifier asks for, assembled from what Field Watch already stores.
//
// Two audiences, one pack:
//   * Buyers doing supply-chain due diligence want supplier identity, the
//     GEOLOCATION of every plot the crop came from, the production period,
//     the quantity, and evidence kept on file. (Rice is not itself an EU
//     Deforestation Regulation commodity — this is the same shape of pack
//     buyers ask for anyway, and what BRM's other crops would need.)
//   * Rice carbon methodologies (Verra VM0051 and friends) want the water
//     practice per parcel per season, and explicitly welcome remote sensing
//     as digital MRV. Field Watch has the rarest half of that already: dated
//     farmer water logs cross-checked against Sentinel-1 radar.
//
// The genuinely useful output is not the pack — it is `packReadiness`, which
// names what is still missing before a pack would survive an auditor.

import { awdSummary, type AwdCheck, type AwdEvent } from "./awd-core";
import { round2 } from "./trade-core";
import { polygonCentroid } from "./geo";
import { csvCell, toCsv, type CsvColumn } from "./csv";

// Geometry lives in geo.ts; re-exported here so existing importers are unaffected.
export { polygonCentroid } from "./geo";

export type PackInput = {
  farmer: {
    full_name: string;
    farmer_code: string;
    village: string | null;
    commune: string | null;
    district: string | null;
    province: string | null;
    certifications: string | null;
  };
  contract: {
    contract_code: string;
    crop_type: string;
    season_label: string;
    signed_date: string | null;
  };
  parcels: {
    farm_code: string;
    farm_name: string | null;
    area_hectares: number | null;
    /** Outer ring as [lon, lat] pairs, or null when the parcel was never drawn. */
    boundary: [number, number][] | null;
    land_tenure: string | null;
    land_tenure_ref: string | null;
  }[];
  deliveries: { received_date: string; gross_weight_kg: number; batch_code: string | null }[];
  waterEvents: AwdEvent[];
  waterChecks: AwdCheck[];
  burnAlerts: number;
};

export type EvidencePack = {
  supplier: { name: string; code: string; address: string; certifications: string | null };
  contract_code: string;
  crop: string;
  season: string;
  plots: {
    farm_code: string;
    farm_name: string | null;
    area_hectares: number | null;
    centroid_lat: number | null;
    centroid_lon: number | null;
    mapped: boolean;
    /** The polygon itself. EUDR wants a boundary above 4 ha, a point at or below. */
    boundary_geojson: { type: "Polygon"; coordinates: [number, number][][] } | null;
    boundary_wkt: string | null;
    land_tenure: string | null;
    land_tenure_ref: string | null;
  }[];
  production_period: { from: string | null; to: string | null };
  quantity_kg: number;
  batch_codes: string[];
  practice: {
    awd_cycles: number;
    radar_passes: number;
    radar_agreement_pct: number | null;
    verdict: string;
    burn_alerts: number;
  };
};

/**
 * A ring as WKT. Upload tools that will not take GeoJSON take this, and it is
 * the form that pastes straight into a PostGIS query if one is ever needed.
 */
export function ringToWkt(ring: [number, number][]): string {
  if (!ring || ring.length < 3) return "";
  const last = ring.length - 1;
  const closed = ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1];
  const pts = closed ? ring : [...ring, ring[0]];
  return `POLYGON((${pts.map(([lon, lat]) => `${lon} ${lat}`).join(", ")}))`;
}

const earliest = (dates: (string | null)[]): string | null => {
  const real = dates.filter((d): d is string => !!d).sort();
  return real[0] ?? null;
};
const latest = (dates: (string | null)[]): string | null => {
  const real = dates.filter((d): d is string => !!d).sort();
  return real[real.length - 1] ?? null;
};

export function buildEvidencePack(input: PackInput): EvidencePack {
  const { farmer, contract, parcels, deliveries, waterEvents, waterChecks, burnAlerts } = input;
  const awd = awdSummary(waterEvents, waterChecks);

  const address = [farmer.village, farmer.commune, farmer.district, farmer.province]
    .filter(Boolean)
    .join(", ");

  const eventDates = waterEvents.map((e) => e.event_date);
  const deliveryDates = deliveries.map((d) => d.received_date);

  return {
    supplier: {
      name: farmer.full_name,
      code: farmer.farmer_code,
      address,
      certifications: farmer.certifications,
    },
    contract_code: contract.contract_code,
    crop: contract.crop_type,
    season: contract.season_label,
    plots: parcels.map((p) => {
      const c = p.boundary ? polygonCentroid(p.boundary) : null;
      const wkt = p.boundary ? ringToWkt(p.boundary) : "";
      return {
        farm_code: p.farm_code,
        farm_name: p.farm_name,
        area_hectares: p.area_hectares,
        centroid_lat: c ? round2(c.lat * 1e6) / 1e6 : null,
        centroid_lon: c ? round2(c.lon * 1e6) / 1e6 : null,
        mapped: c !== null,
        boundary_geojson: p.boundary ? { type: "Polygon" as const, coordinates: [p.boundary] } : null,
        boundary_wkt: wkt === "" ? null : wkt,
        land_tenure: p.land_tenure,
        land_tenure_ref: p.land_tenure_ref,
      };
    }),
    production_period: {
      // Signing opens the period when it is known; otherwise the first thing
      // that actually happened in the field does.
      from: earliest([contract.signed_date, ...eventDates, ...deliveryDates]),
      to: latest([contract.signed_date, ...eventDates, ...deliveryDates]),
    },
    quantity_kg: deliveries.reduce((s, d) => s + d.gross_weight_kg, 0),
    batch_codes: [...new Set(deliveries.map((d) => d.batch_code).filter((b): b is string => !!b))],
    practice: {
      awd_cycles: awd.cycles,
      radar_passes: awd.radarPasses,
      radar_agreement_pct: awd.agreementPct,
      verdict: awd.verdict,
      burn_alerts: burnAlerts,
    },
  };
}

export type PackReadiness = { ready: boolean; missing: string[]; warnings: string[] };

/**
 * The plot-level checks, shared by contract packs and batch packs so the 4 ha
 * rule cannot drift into two versions.
 */
function plotChecks(plots: EvidencePack["plots"]): { missing: string[]; warnings: string[] } {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (plots.length === 0) {
    missing.push("No parcel on file — add the farm and draw its boundary");
    return { missing, warnings };
  }

  // A polygon is required above 4 ha; at or below it a point is usually
  // accepted. An unmapped plot has only the farmer's claimed area to go on,
  // which is exactly why the large ones cannot be waved through.
  const unmapped = plots.filter((p) => !p.mapped);
  const large = unmapped.filter((p) => (p.area_hectares ?? 0) > 4);
  const small = unmapped.filter((p) => (p.area_hectares ?? 0) <= 4);
  if (large.length > 0) {
    missing.push(
      `${large.length} parcel${large.length === 1 ? "" : "s"} over 4 ha with no boundary — draw ${large
        .map((p) => p.farm_code)
        .join(", ")} on the map`,
    );
  }
  if (small.length > 0) {
    warnings.push(
      `${small.length} parcel${small.length === 1 ? "" : "s"} of 4 ha or less with no boundary (${small
        .map((p) => p.farm_code)
        .join(", ")}) — a point may be accepted, a boundary is safer`,
    );
  }
  const untenured = plots.filter((p) => !p.land_tenure);
  if (untenured.length > 0) {
    warnings.push(`Land tenure not recorded for ${untenured.map((p) => p.farm_code).join(", ")}`);
  }
  return { missing, warnings };
}

/** What still has to be recorded before this pack would stand up to an audit. */
export function packReadiness(pack: EvidencePack): PackReadiness {
  const missing: string[] = [];
  const warnings: string[] = [];

  const plots = plotChecks(pack.plots);
  missing.push(...plots.missing);
  warnings.push(...plots.warnings);

  if (pack.quantity_kg === 0) missing.push("Nothing delivered against this contract yet");
  if (pack.practice.radar_passes === 0) {
    missing.push("No radar cross-check yet — run the water scan to back up the field log");
  }

  if (pack.practice.awd_cycles === 0 && pack.practice.radar_passes > 0) {
    warnings.push("No drain-down logged this season — the field reads as continuously flooded");
  }
  if (pack.practice.radar_passes > 0 && pack.practice.radar_agreement_pct === null) {
    warnings.push(
      `${pack.practice.radar_passes} radar pass${pack.practice.radar_passes === 1 ? "" : "es"} but none decisive — re-running the scan will not change this`,
    );
  }
  if (pack.practice.verdict === "partial") {
    warnings.push("Radar agrees with only some of the water log — worth reviewing before it is quoted");
  }
  if (pack.practice.burn_alerts > 0) {
    warnings.push(
      `${pack.practice.burn_alerts} possible burn${pack.practice.burn_alerts === 1 ? "" : "s"} detected near these fields`,
    );
  }
  if (pack.batch_codes.length === 0 && pack.quantity_kg > 0) {
    warnings.push("Delivered rice is not in a batch, so the pack cannot follow it past the gate");
  }

  return { ready: missing.length === 0, missing, warnings };
}

/**
 * A FeatureCollection of plots — the file a due-diligence upload actually
 * ingests. The CSV beside it is the copy a person reads. Unmapped plots are
 * absent by necessity: a Feature without geometry is not a plot location, and
 * packReadiness is where their absence is reported.
 */
export function packGeoJson(packs: EvidencePack[]) {
  const features = [];
  for (const p of packs) {
    for (const plot of p.plots) {
      if (!plot.boundary_geojson) continue;
      features.push({
        type: "Feature" as const,
        geometry: plot.boundary_geojson,
        properties: {
          farm_code: plot.farm_code,
          farm_name: plot.farm_name,
          area_hectares: plot.area_hectares,
          land_tenure: plot.land_tenure,
          land_tenure_ref: plot.land_tenure_ref,
          supplier_code: p.supplier.code,
          supplier_name: p.supplier.name,
          contract_code: p.contract_code,
          crop: p.crop,
          season: p.season,
          quantity_kg: p.quantity_kg,
          production_from: p.production_period.from,
          production_to: p.production_period.to,
        },
      });
    }
  }
  return { type: "FeatureCollection" as const, features };
}

const CSV_COLUMNS = [
  "farmer_code",
  "farmer_name",
  "address",
  "certifications",
  "contract_code",
  "crop",
  "season",
  "farm_code",
  "farm_name",
  "area_hectares",
  "centroid_lat",
  "centroid_lon",
  "boundary_wkt",
  "land_tenure",
  "land_tenure_ref",
  "production_from",
  "production_to",
  "quantity_kg",
  "batch_codes",
  "awd_cycles",
  "radar_passes",
  "radar_agreement_pct",
  "practice_verdict",
  "burn_alerts",
  "missing_for_audit",
] as const;

/** One row per plot — the grain a plot-geolocation upload expects. */
export function packCsv(packs: EvidencePack[]): string {
  const rows: string[] = [CSV_COLUMNS.join(",")];
  for (const p of packs) {
    const readiness = packReadiness(p);
    const shared = [
      p.supplier.code,
      p.supplier.name,
      p.supplier.address,
      p.supplier.certifications,
      p.contract_code,
      p.crop,
      p.season,
    ];
    const tail = [
      p.production_period.from,
      p.production_period.to,
      p.quantity_kg,
      p.batch_codes.join(" "),
      p.practice.awd_cycles,
      p.practice.radar_passes,
      p.practice.radar_agreement_pct,
      p.practice.verdict,
      p.practice.burn_alerts,
      readiness.missing.join("; "),
    ];
    // A farmer with no mapped parcel still belongs in the file — the empty
    // plot columns are exactly what the reviewer needs to see.
    const plots = p.plots.length > 0 ? p.plots : [null];
    for (const plot of plots) {
      rows.push(
        [
          ...shared,
          plot?.farm_code ?? null,
          plot?.farm_name ?? null,
          plot?.area_hectares ?? null,
          plot?.centroid_lat ?? null,
          plot?.centroid_lon ?? null,
          plot?.boundary_wkt ?? null,
          plot?.land_tenure ?? null,
          plot?.land_tenure_ref ?? null,
          ...tail,
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return rows.join("\n") + "\n";
}

export type BatchPack = {
  batch_code: string;
  custody_model: string;
  crop: string;
  suppliers: EvidencePack["supplier"][];
  contract_codes: string[];
  seasons: string[];
  plots: EvidencePack["plots"];
  production_period: { from: string | null; to: string | null };
  quantity_kg: number;
  practice: EvidencePack["practice"];
};

/**
 * A pack at the grain a buyer actually buys: the batch.
 *
 * Contract packs are the input, so every field is computed once, in
 * buildEvidencePack, and merged here. A mass-balance batch has several
 * contracts behind it and therefore several suppliers; an identity-preserved
 * batch has one, and the shape does not change between them.
 *
 * quantity_kg is passed in rather than summed from the packs: what matters is
 * the weight delivered into THIS batch, which is a subset of everything those
 * contracts ever delivered.
 */
export function buildBatchPack(input: {
  batch: { batch_code: string; custody_model: string };
  packs: EvidencePack[];
  quantity_kg: number;
}): BatchPack {
  const { batch, packs, quantity_kg } = input;

  const uniqueBy = <T,>(items: T[], key: (t: T) => string): T[] => {
    const seen = new Set<string>();
    return items.filter((i) => {
      const k = key(i);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  const agreements = packs
    .map((p) => p.practice.radar_agreement_pct)
    .filter((a): a is number => a !== null);
  const verdicts = [...new Set(packs.map((p) => p.practice.verdict))];

  return {
    batch_code: batch.batch_code,
    custody_model: batch.custody_model,
    crop: packs[0]?.crop ?? "",
    suppliers: uniqueBy(packs.map((p) => p.supplier), (s) => s.code),
    contract_codes: [...new Set(packs.map((p) => p.contract_code))],
    seasons: [...new Set(packs.map((p) => p.season))],
    plots: uniqueBy(packs.flatMap((p) => p.plots), (p) => p.farm_code),
    production_period: {
      from: earliest(packs.map((p) => p.production_period.from)),
      to: latest(packs.map((p) => p.production_period.to)),
    },
    quantity_kg,
    practice: {
      awd_cycles: packs.reduce((s, p) => s + p.practice.awd_cycles, 0),
      radar_passes: packs.reduce((s, p) => s + p.practice.radar_passes, 0),
      radar_agreement_pct:
        agreements.length > 0 ? round2(agreements.reduce((s, a) => s + a, 0) / agreements.length) : null,
      // One dissenting contract makes the batch's practice claim mixed. Saying
      // "confirmed" for a batch where one farmer's log did not match would be
      // the pack lying on the mill's behalf.
      verdict: verdicts.length === 1 ? verdicts[0] : "mixed",
      burn_alerts: packs.reduce((s, p) => s + p.practice.burn_alerts, 0),
    },
  };
}

/** Batch-level readiness. Plot rules are shared with the contract pack. */
export function batchReadiness(pack: BatchPack): PackReadiness {
  const { missing, warnings } = plotChecks(pack.plots);
  if (pack.quantity_kg === 0) missing.push("Nothing delivered into this batch yet");
  if (pack.practice.burn_alerts > 0) {
    warnings.push(
      `${pack.practice.burn_alerts} possible burn${pack.practice.burn_alerts === 1 ? "" : "s"} on the fields behind this batch`,
    );
  }
  if (pack.practice.verdict === "mixed") {
    warnings.push("Contributing farmers' water practice does not agree — do not quote one verdict for the batch");
  }
  return { ready: missing.length === 0, missing, warnings };
}

const BATCH_CSV_COLUMNS: CsvColumn<{ pack: BatchPack; plot: EvidencePack["plots"][number] | null }>[] = [
  { key: "batch_code", get: (r) => r.pack.batch_code },
  { key: "custody_model", get: (r) => r.pack.custody_model },
  { key: "crop", get: (r) => r.pack.crop },
  { key: "seasons", get: (r) => r.pack.seasons.join(" ") },
  { key: "suppliers", get: (r) => r.pack.suppliers.map((s) => s.code).join(" ") },
  { key: "contract_codes", get: (r) => r.pack.contract_codes.join(" ") },
  { key: "farm_code", get: (r) => r.plot?.farm_code ?? null },
  { key: "farm_name", get: (r) => r.plot?.farm_name ?? null },
  { key: "area_hectares", get: (r) => r.plot?.area_hectares ?? null },
  { key: "centroid_lat", get: (r) => r.plot?.centroid_lat ?? null },
  { key: "centroid_lon", get: (r) => r.plot?.centroid_lon ?? null },
  { key: "boundary_wkt", get: (r) => r.plot?.boundary_wkt ?? null },
  { key: "land_tenure", get: (r) => r.plot?.land_tenure ?? null },
  { key: "land_tenure_ref", get: (r) => r.plot?.land_tenure_ref ?? null },
  { key: "production_from", get: (r) => r.pack.production_period.from },
  { key: "production_to", get: (r) => r.pack.production_period.to },
  { key: "quantity_kg", get: (r) => r.pack.quantity_kg },
  { key: "awd_cycles", get: (r) => r.pack.practice.awd_cycles },
  { key: "radar_passes", get: (r) => r.pack.practice.radar_passes },
  { key: "radar_agreement_pct", get: (r) => r.pack.practice.radar_agreement_pct },
  { key: "practice_verdict", get: (r) => r.pack.practice.verdict },
  { key: "burn_alerts", get: (r) => r.pack.practice.burn_alerts },
  { key: "missing_for_audit", get: (r) => batchReadiness(r.pack).missing.join("; ") },
];

/** One row per plot, same grain as packCsv — a batch with no mapped plot still gets a row. */
export function batchPackCsv(packs: BatchPack[]): string {
  const rows = packs.flatMap((pack) =>
    (pack.plots.length > 0 ? pack.plots : [null]).map((plot) => ({ pack, plot })),
  );
  return toCsv(rows, BATCH_CSV_COLUMNS);
}

/** The plot geometry behind a batch, as the FeatureCollection an upload takes. */
export function batchPackGeoJson(packs: BatchPack[]) {
  const features = [];
  for (const p of packs) {
    for (const plot of p.plots) {
      if (!plot.boundary_geojson) continue;
      features.push({
        type: "Feature" as const,
        geometry: plot.boundary_geojson,
        properties: {
          farm_code: plot.farm_code,
          farm_name: plot.farm_name,
          area_hectares: plot.area_hectares,
          land_tenure: plot.land_tenure,
          land_tenure_ref: plot.land_tenure_ref,
          batch_code: p.batch_code,
          custody_model: p.custody_model,
          crop: p.crop,
          seasons: p.seasons.join(" "),
          suppliers: p.suppliers.map((s) => s.code).join(" "),
          contract_codes: p.contract_codes.join(" "),
          quantity_kg: p.quantity_kg,
          production_from: p.production_period.from,
          production_to: p.production_period.to,
        },
      });
    }
  }
  return { type: "FeatureCollection" as const, features };
}
