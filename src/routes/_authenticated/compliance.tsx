// Evidence packs — the origin record a buyer's due-diligence team or a rice
// carbon verifier asks for, per contract, from records already in the system.
//
// The page's real job is the "Missing" column: it says what has not been
// recorded yet, while there is still time to record it.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ok } from "@/lib/supabase-helpers";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Check, Download, ShieldCheck } from "lucide-react";
import {
  batchPackCsv,
  batchPackGeoJson,
  batchReadiness,
  buildBatchPack,
  buildEvidencePack,
  packCsv,
  packGeoJson,
  packReadiness,
  type BatchPack,
  type EvidencePack,
  type PackInput,
  type PackReadiness,
} from "@/lib/compliance-core";
import { classifyWater, crossCheck, type LoggedWaterEvent } from "@/lib/water-core";
import { findOverlaps, type OverlapPair, type OverlapParcel } from "@/lib/overlap-core";
import type { PolygonGeo } from "@/lib/firms-core";
import { custodyLabel } from "@/lib/labels";

export const Route = createFileRoute("/_authenticated/compliance")({
  component: CompliancePage,
});

type Row = { pack: EvidencePack; readiness: PackReadiness };

/** Radar and field logs are read over the same window the parcel cards use. */
const WINDOW_DAYS = 120;

function CompliancePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [overlaps, setOverlaps] = useState<OverlapPair[]>([]);
  const [batchRows, setBatchRows] = useState<{ pack: BatchPack; readiness: PackReadiness }[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const contractsRes = await supabase
      .from("contracts")
      .select(
        "contract_code, crop_type, season_label, signed_date, farmer_id, farmers(full_name, farmer_code, village, commune, district, province, certifications)",
      )
      .order("created_at", { ascending: false });
    setLoaded(true);
    if (!ok(contractsRes.error, "Load contracts")) return;
    type ContractRow = {
      contract_code: string;
      crop_type: string;
      season_label: string;
      signed_date: string | null;
      farmer_id: string;
      farmers: PackInput["farmer"] | null;
    };
    const contracts = (contractsRes.data as unknown as ContractRow[]) ?? [];
    if (contracts.length === 0) {
      setRows([]);
      return;
    }

    const farmerIds = [...new Set(contracts.map((c) => c.farmer_id))];
    const [farmsRes, deliveriesRes] = await Promise.all([
      supabase
        .from("farms")
        .select("id, farmer_id, farm_code, farm_name, area_hectares, boundary_geojson, land_tenure, land_tenure_ref")
        .in("farmer_id", farmerIds),
      supabase
        .from("deliveries")
        .select("received_date, gross_weight_kg, contracts(contract_code), batches(batch_code)")
        .order("received_date", { ascending: true }),
    ]);
    if (!ok(farmsRes.error, "Load farms")) return;
    if (!ok(deliveriesRes.error, "Load deliveries")) return;

    const farms = farmsRes.data ?? [];
    const farmIds = farms.map((f) => f.id);

    // Overlap is a property of the geometry, so it is derived on load rather
    // than stored — a stored flag goes stale the moment a boundary is redrawn.
    const parcels: OverlapParcel[] = farms
      .filter((f) => outerRing(f.boundary_geojson))
      .map((f) => ({
        id: f.id,
        farm_code: f.farm_code,
        farm_name: f.farm_name,
        boundary: f.boundary_geojson as unknown as PolygonGeo,
      }));
    setOverlaps(findOverlaps(parcels));

    // Water logs and radar passes for every parcel in one round trip each,
    // then cross-checked in memory — one query per table, not per farmer.
    let events: (LoggedWaterEvent & { farm_id: string; event_type: string | null })[] = [];
    let readings: {
      farm_id: string;
      reading_date: string;
      vv_db: number;
      vh_db: number;
      state: string;
      confident: boolean;
    }[] = [];
    let burnByFarmer: Record<string, number> = {};
    if (farmIds.length > 0) {
      const [evRes, waterRes, alertsRes] = await Promise.all([
        supabase
          .from("field_events")
          .select("farm_id, event_type, event_date, water_state")
          .in("farm_id", farmIds)
          .eq("event_type", "water")
          .gte("event_date", since),
        supabase
          .from("parcel_water")
          .select("farm_id, reading_date, vv_db, vh_db, state, confident")
          .in("farm_id", farmIds)
          .gte("reading_date", since),
        supabase.from("alerts").select("farmer_id").in("farm_id", farmIds).eq("alert_type", "possible_burn"),
      ]);
      if (!ok(evRes.error, "Load water events")) return;
      if (!ok(waterRes.error, "Load radar readings")) return;
      events = (evRes.data ?? []) as unknown as (LoggedWaterEvent & { farm_id: string; event_type: string | null })[];
      readings = (waterRes.data ?? []) as unknown as typeof readings;
      if (!alertsRes.error) {
        burnByFarmer = (alertsRes.data ?? []).reduce<Record<string, number>>((acc, a) => {
          if (a.farmer_id) acc[a.farmer_id] = (acc[a.farmer_id] ?? 0) + 1;
          return acc;
        }, {});
      }
    }

    type DeliveryRow = {
      received_date: string;
      gross_weight_kg: number;
      contracts: { contract_code: string } | null;
      batches: { batch_code: string } | null;
    };
    const deliveries = (deliveriesRes.data as unknown as DeliveryRow[]) ?? [];

    const built = contracts
      .filter((c) => c.farmers)
      .map((c) => {
        const theirFarms = farms.filter((f) => f.farmer_id === c.farmer_id);
        const theirFarmIds = theirFarms.map((f) => f.id);
        const theirEvents = events.filter((e) => theirFarmIds.includes(e.farm_id));
        const theirReadings = readings.filter((r) => theirFarmIds.includes(r.farm_id));

        const pack = buildEvidencePack({
          farmer: c.farmers!,
          contract: {
            contract_code: c.contract_code,
            crop_type: c.crop_type,
            season_label: c.season_label,
            signed_date: c.signed_date,
          },
          parcels: theirFarms.map((f) => ({
            farm_code: f.farm_code,
            farm_name: f.farm_name,
            area_hectares: f.area_hectares,
            boundary: outerRing(f.boundary_geojson),
            land_tenure: f.land_tenure,
            land_tenure_ref: f.land_tenure_ref,
          })),
          deliveries: deliveries
            .filter((d) => d.contracts?.contract_code === c.contract_code)
            .map((d) => ({
              received_date: d.received_date,
              gross_weight_kg: d.gross_weight_kg,
              batch_code: d.batches?.batch_code ?? null,
            })),
          waterEvents: theirEvents.map((e) => ({
            event_type: e.event_type ?? "water",
            water_state: e.water_state,
            event_date: e.event_date,
          })),
          waterChecks: theirReadings.map((r) => crossCheck(r, classifyWater(r), theirEvents)),
          burnAlerts: burnByFarmer[c.farmer_id] ?? 0,
        });
        return { pack, readiness: packReadiness(pack) };
      });

    setRows(built);

    // Batch packs are merged from the contract packs just built — a buyer buys
    // a shipment, and a mass-balance batch has several contracts behind it.
    // The deliveries query already carries batches(batch_code), so grouping
    // needs no extra round trip; only custody_model has to be fetched.
    const batchesRes = await supabase
      .from("batches")
      .select("batch_code, custody_model")
      .order("created_date", { ascending: false });
    if (!ok(batchesRes.error, "Load batches")) return;

    const byBatch = new Map<string, { kg: number; contractCodes: Set<string> }>();
    for (const d of deliveries) {
      const code = d.batches?.batch_code;
      if (!code) continue;
      const entry = byBatch.get(code) ?? { kg: 0, contractCodes: new Set<string>() };
      entry.kg += d.gross_weight_kg;
      if (d.contracts?.contract_code) entry.contractCodes.add(d.contracts.contract_code);
      byBatch.set(code, entry);
    }

    const packByContract = new Map(built.map((b) => [b.pack.contract_code, b.pack]));
    setBatchRows(
      (batchesRes.data ?? []).map((b) => {
        const fed = byBatch.get(b.batch_code) ?? { kg: 0, contractCodes: new Set<string>() };
        const packs = [...fed.contractCodes]
          .map((c) => packByContract.get(c))
          .filter((p): p is NonNullable<typeof p> => !!p);
        const pack = buildBatchPack({
          batch: { batch_code: b.batch_code, custody_model: b.custody_model },
          packs,
          quantity_kg: fed.kg,
        });
        return { pack, readiness: batchReadiness(pack) };
      }),
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const readyCount = useMemo(() => rows.filter((r) => r.readiness.ready).length, [rows]);

  // The file is built in the browser and never round-trips to a server.
  const save = (name: string, body: string, mime: string) => {
    const url = URL.createObjectURL(new Blob([body], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const download = (subset: Row[], name: string) => {
    if (subset.length === 0) {
      toast.error("Nothing to export yet.");
      return;
    }
    save(name, packCsv(subset.map((r) => r.pack)), "text/csv;charset=utf-8");
    toast.success(`${subset.length} pack${subset.length === 1 ? "" : "s"} exported`);
  };

  // GeoJSON is what a due-diligence upload ingests; the CSV is the copy a
  // person reads. Plots that were never drawn have no geometry and so cannot
  // appear — packReadiness is where their absence is reported.
  const downloadGeoJson = (subset: Row[], name: string) => {
    const fc = packGeoJson(subset.map((r) => r.pack));
    if (fc.features.length === 0) {
      toast.error("No mapped parcels to export yet.");
      return;
    }
    save(name, JSON.stringify(fc, null, 2), "application/geo+json");
    toast.success(`${fc.features.length} plot${fc.features.length === 1 ? "" : "s"} exported`);
  };

  const downloadBatches = (name: string, format: "csv" | "geojson") => {
    if (batchRows.length === 0) {
      toast.error("No batches yet.");
      return;
    }
    const packs = batchRows.map((r) => r.pack);
    if (format === "csv") {
      save(name, batchPackCsv(packs), "text/csv;charset=utf-8");
      toast.success(`${packs.length} batch pack${packs.length === 1 ? "" : "s"} exported`);
      return;
    }
    const fc = batchPackGeoJson(packs);
    if (fc.features.length === 0) {
      toast.error("No mapped parcels behind these batches yet.");
      return;
    }
    save(name, JSON.stringify(fc, null, 2), "application/geo+json");
    toast.success(`${fc.features.length} plot${fc.features.length === 1 ? "" : "s"} exported`);
  };

  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Evidence packs</h1>
          <p className="text-sm text-muted-foreground">
            Where each contract's rice came from, how the field was managed, and what is still missing.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => download(rows.filter((r) => r.readiness.ready), `evidence-packs-ready-${stamp}.csv`)}>
            <Download className="h-4 w-4 mr-1" />
            Export ready
          </Button>
          <Button onClick={() => download(rows, `evidence-packs-all-${stamp}.csv`)}>
            <Download className="h-4 w-4 mr-1" />
            Export all
          </Button>
          <Button variant="outline" onClick={() => downloadGeoJson(rows, `evidence-plots-${stamp}.geojson`)}>
            <Download className="h-4 w-4 mr-1" />
            Plots (GeoJSON)
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap gap-6 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Contracts</p>
            <p className="font-semibold tabular-nums">{rows.length}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Ready for a buyer</p>
            <p className="font-semibold tabular-nums text-chart-2">{readyCount}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Need records</p>
            <p className="font-semibold tabular-nums">{rows.length - readyCount}</p>
          </div>
        </CardContent>
      </Card>

      {overlaps.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Overlapping parcels ({overlaps.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Two boundaries covering the same ground. Either one was drawn wrong, or the same field
              is registered to two farmers and drawing inputs twice.
            </p>
            {overlaps.map((o) => {
              // findOverlaps may report containment either way round; put the
              // container first so the sentence always reads left to right.
              const [outer, inner] =
                o.kind === "b_contains_a" ? [o.b, o.a] : [o.a, o.b];
              return (
                <div key={`${o.a.id}-${o.b.id}`} className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{outer.farm_code}</Badge>
                  <span className="text-muted-foreground">
                    {o.kind === "crosses" ? "shares ground with" : "contains"}
                  </span>
                  <Badge variant="outline">{inner.farm_code}</Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">By contract</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contract</TableHead>
                  <TableHead>Farmer</TableHead>
                  <TableHead>Plots</TableHead>
                  <TableHead>Delivered</TableHead>
                  <TableHead>Water practice</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Missing</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loaded && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No contracts yet. Packs are built from contracts, their parcels and their deliveries.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map(({ pack, readiness }) => (
                  <TableRow key={pack.contract_code}>
                    <TableCell className="font-medium">{pack.contract_code}</TableCell>
                    <TableCell>
                      {pack.supplier.name}
                      <span className="block text-xs text-muted-foreground">{pack.supplier.address || "—"}</span>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {pack.plots.filter((p) => p.mapped).length}/{pack.plots.length} mapped
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {pack.quantity_kg ? `${pack.quantity_kg.toLocaleString()} kg` : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {pack.practice.awd_cycles} dry-down{pack.practice.awd_cycles === 1 ? "" : "s"}
                      {/* A pass that could not be judged is not the same as no
                          pass at all — saying "no radar yet" for either would
                          send someone to re-run a scan that already ran. */}
                      {pack.practice.radar_passes === 0
                        ? " · no radar yet"
                        : pack.practice.radar_agreement_pct !== null
                          ? ` · radar agrees ${pack.practice.radar_agreement_pct}% of ${pack.practice.radar_passes} passes`
                          : ` · ${pack.practice.radar_passes} radar pass${pack.practice.radar_passes === 1 ? "" : "es"}, none decisive`}
                    </TableCell>
                    <TableCell>
                      {readiness.ready ? (
                        <Badge variant="outline" className="border-chart-2 text-chart-2 gap-1 font-normal">
                          <Check className="h-3 w-3" />
                          Ready
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="font-normal">
                          Incomplete
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs max-w-sm">
                      {readiness.missing.length === 0 && readiness.warnings.length === 0 && (
                        <span className="text-muted-foreground">—</span>
                      )}
                      <ul className="space-y-0.5">
                        {readiness.missing.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                        {readiness.warnings.map((w) => (
                          <li key={w} className="text-chart-4 flex gap-1">
                            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                            {w}
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">By batch ({batchRows.length})</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => downloadBatches(`batch-packs-${stamp}.csv`, "csv")}>
              <Download className="h-4 w-4 mr-1" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadBatches(`batch-plots-${stamp}.geojson`, "geojson")}>
              <Download className="h-4 w-4 mr-1" />
              GeoJSON
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead>Custody</TableHead>
                  <TableHead>Suppliers</TableHead>
                  <TableHead>Plots</TableHead>
                  <TableHead>Into batch</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Missing</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loaded && batchRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No batches yet. A batch pack is what a buyer asks for, because a buyer buys a
                      shipment rather than a contract.
                    </TableCell>
                  </TableRow>
                )}
                {batchRows.map(({ pack, readiness }) => (
                  <TableRow key={pack.batch_code}>
                    <TableCell className="font-medium">{pack.batch_code}</TableCell>
                    <TableCell className="text-sm">
                      {custodyLabel(pack.custody_model)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {pack.suppliers.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          {pack.suppliers[0].name}
                          {pack.suppliers.length > 1 && (
                            <span className="block text-xs text-muted-foreground">
                              +{pack.suppliers.length - 1} more · {pack.contract_codes.length} contracts
                            </span>
                          )}
                        </>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {pack.plots.filter((p) => p.mapped).length}/{pack.plots.length} mapped
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {pack.quantity_kg ? `${pack.quantity_kg.toLocaleString()} kg` : "—"}
                    </TableCell>
                    <TableCell>
                      {readiness.ready ? (
                        <Badge variant="outline" className="border-chart-2 text-chart-2 gap-1 font-normal">
                          <Check className="h-3 w-3" />
                          Ready
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="font-normal">
                          Incomplete
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs max-w-sm">
                      {readiness.missing.length === 0 && readiness.warnings.length === 0 && (
                        <span className="text-muted-foreground">—</span>
                      )}
                      <ul className="space-y-0.5">
                        {readiness.missing.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                        {readiness.warnings.map((w) => (
                          <li key={w} className="text-chart-4 flex gap-1">
                            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                            {w}
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            What the export contains
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            <strong className="text-foreground">CSV</strong> — one row per parcel: supplier and address, contract,
            crop and season, the parcel's code and area, both its centre point and its full boundary, land tenure,
            the production period, kilos delivered, batch codes, and the water practice with how far Sentinel-1
            radar backs it up. The batch export is the same at shipment grain, listing every supplier and contract
            that fed the batch.
          </p>
          <p>
            <strong className="text-foreground">GeoJSON</strong> — the plot boundaries alone, in the form a
            due-diligence upload ingests. A plot needs geometry to appear, so parcels that were never drawn are
            absent from it entirely; the CSV still lists them, with the boundary columns empty.
          </p>
          <p>
            Buyers running origin due diligence ask for plot geolocation, production dates and quantity. A boundary
            is expected above 4 ha and a point is usually accepted at or below it, which is why the Missing column
            treats the two sizes differently. Rice carbon methodologies ask for the water practice per parcel per
            season and accept satellite readings as evidence. Draw any missing boundary on the{" "}
            <Link to="/map" className="underline">
              map
            </Link>{" "}
            first.
          </p>
          <p>
            What this pack does <strong className="text-foreground">not</strong> evidence: it carries no
            forest-loss check, so it shows origin, practice and legality — not that the land was deforestation-free.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/** The outer ring of a stored GeoJSON polygon, or null when it is not one. */
function outerRing(geo: unknown): [number, number][] | null {
  if (!geo || typeof geo !== "object") return null;
  const poly = geo as { type?: string; coordinates?: unknown };
  if (poly.type !== "Polygon" || !Array.isArray(poly.coordinates)) return null;
  const ring = poly.coordinates[0];
  if (!Array.isArray(ring) || ring.length < 3) return null;
  return ring as [number, number][];
}
