import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClientOnly } from "@tanstack/react-router";
import { toast } from "sonner";
import { ok } from "@/lib/supabase-helpers";
import { useConfirm } from "@/components/confirm";
import { fetchHotspots } from "@/lib/firms";
import { BURN_ZONE, type Hotspot, type PolygonGeo } from "@/lib/firms-core";
import { polygonsOverlap } from "@/lib/overlap-core";
import { polygonAreaHa, toPolygonGeo, validatePolygon } from "@/lib/geo";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { zoneStats } from "@/lib/zone-stats";
import { Flame, Droplets, Leaf, MapPin as MapPinIcon, Ruler, Pause, Play } from "lucide-react";
import { EstateMap } from "@/components/estate-map";
import { Input } from "@/components/ui/input";
import { frameDates, parcelFeatures, readingsAt, type ColorMode, type WaterLite } from "@/lib/estate-map-core";
import {
  daysBetween,
  healthColor,
  latestByFarm,
  vegetationLabel,
  waterLabel,
  type HealthRow,
} from "@/lib/health-core";

type Farm = Database["public"]["Tables"]["farms"]["Row"];
type FarmWithFarmer = Farm & { farmers?: { full_name: string } | null };

const CONFIDENCE_LABEL: Record<string, string> = { l: "low", n: "nominal", h: "high" };

/** Two reading sets are the same when every parcel's newest reading matches. */
function sameReadings(a: Map<string, HealthRow>, b: Map<string, HealthRow>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, row] of a) {
    const other = b.get(id);
    if (
      !other ||
      other.reading_date !== row.reading_date ||
      other.ndvi_mean !== row.ndvi_mean ||
      other.ndmi_mean !== row.ndmi_mean
    ) {
      return false;
    }
  }
  return true;
}

export const Route = createFileRoute("/_authenticated/map")({
  component: MapPage,
  validateSearch: (s: Record<string, unknown>): { draw?: string } => ({
    draw: typeof s.draw === "string" ? s.draw : undefined,
  }),
});

function MapPage() {
  const [farms, setFarms] = useState<FarmWithFarmer[]>([]);
  const [provinceFilter, setProvinceFilter] = useState("all");
  const [cropFilter, setCropFilter] = useState("all");
  const [provinces, setProvinces] = useState<string[]>([]);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const { draw } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { confirm, confirmDialog } = useConfirm();
  const [health, setHealth] = useState<Map<string, HealthRow>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [scanningWater, setScanningWater] = useState(false);
  const { hasAnyRole } = useAuth();
  const { t } = useI18n();
  const [healthRows, setHealthRows] = useState<HealthRow[]>([]);
  const [drySpellEvents, setDrySpellEvents] = useState(0);
  const [fireAlerts30d, setFireAlerts30d] = useState(0);
  const [waterRows, setWaterRows] = useState<WaterLite[]>([]);
  const [colorMode, setColorMode] = useState<ColorMode>("ndvi");
  const [frameDate, setFrameDate] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layersOn, setLayersOn] = useState({ canals: true, roads: true, blocks: true, own: true });
  const [listFilter, setListFilter] = useState("");

  const loadFarms = () => {
    supabase.from("farms").select("*, farmers(full_name)").then(({ data }) => {
      const d = data || [];
      setFarms(d);
      const provs = [...new Set(d.map((f) => f.province).filter(Boolean))] as string[];
      setProvinces(provs);
    });
  };

  const loadHealth = () => {
    // Unbounded reads get truncated at PostgREST's row cap and, with no
    // ordering, return the oldest rows — so once the table fills the map
    // would silently colour parcels from year-old readings. A 90-day floor
    // keeps a stale parcel honestly grey instead.
    const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    supabase
      .from("parcel_health")
      .select("farm_id, reading_date, ndvi_mean, ndmi_mean, cloud_pct")
      .gte("reading_date", since)
      .then(({ data }) => {
        const rows = (data ?? []) as HealthRow[];
        setHealthRows(rows);
        const next = latestByFarm(rows);
        setHealth((held) => (sameReadings(held, next) ? held : next));
      });
  };

  // Runs the scan for real parcels. Admin/manager only — the edge function
  // checks the caller's role again on its side.
  // Same shape as refreshHealth, against the radar function. Kept separate
  // because the two scans fail independently and a shared spinner would hide
  // which one broke.
  const refreshWater = async () => {
    setScanningWater(true);
    const { data, error } = await supabase.functions.invoke("water-scan");
    setScanningWater(false);
    if (error) {
      let message = error.message;
      if (error instanceof FunctionsHttpError) {
        try {
          const body = await error.context.json();
          if (body?.error) message = body.error;
        } catch {
          // keep the transport message
        }
      }
      toast.error(`Radar scan failed: ${message}`);
      return;
    }
    const result = data as {
      readings?: number;
      flooded?: number;
      drained?: number;
      uncertain?: number;
      skipped?: string[];
    };
    toast.success(
      `Radar scan: ${result?.readings ?? 0} pass(es) — ${result?.flooded ?? 0} flooded, ${result?.drained ?? 0} drained, ${result?.uncertain ?? 0} unclear.`,
    );
    if (result?.skipped?.length) {
      const shown = result.skipped.slice(0, 3).join("; ");
      const more = result.skipped.length > 3 ? ` …and ${result.skipped.length - 3} more` : "";
      toast.warning(`${result.skipped.length} parcel(s) could not be scanned: ${shown}${more}`);
    }
  };

  const refreshHealth = async () => {
    setRefreshing(true);
    const { data, error } = await supabase.functions.invoke("health-scan");
    setRefreshing(false);
    if (error) {
      // invoke() reports every non-2xx as the same generic message; the real
      // reason is in the response body.
      let message = error.message;
      if (error instanceof FunctionsHttpError) {
        try {
          const body = await error.context.json();
          if (body?.error) message = body.error;
        } catch {
          // keep the transport message
        }
      }
      toast.error(`Refresh health failed: ${message}`);
      return;
    }
    const result = data as { readings?: number; newAlerts?: number; skipped?: string[] };
    toast.success(
      `Satellite health updated: ${result?.readings ?? 0} new reading(s), ${result?.newAlerts ?? 0} new alert(s).`,
    );
    // The scan skips a parcel rather than failing the whole run — say so, or
    // those failures are invisible.
    if (result?.skipped?.length) {
      const shown = result.skipped.slice(0, 3).join("; ");
      const more = result.skipped.length > 3 ? ` …and ${result.skipped.length - 3} more` : "";
      toast.warning(`${result.skipped.length} parcel(s) could not be scanned: ${shown}${more}`);
    }
    loadHealth();
  };

  useEffect(() => {
    loadFarms();
    loadHealth();
    const d30w = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    supabase
      .from("parcel_water")
      .select("farm_id, reading_date, state, confident")
      .gte("reading_date", d30w)
      .limit(1000)
      .then(({ data }) => setWaterRows((data ?? []) as WaterLite[]));
    // Read-only fire layer: last 5 days of hotspots in the BRM zone (FIRMS NRT max).
    fetchHotspots({ data: { days: 5 } }).then((r) => {
      if (!r.error) setHotspots(r.hotspots);
    });
    // Zone band: AWD dry-spell records on active seasons + fire alerts, 30 days.
    const d30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    supabase
      .from("field_events")
      .select("id, crop_cycles!inner(status)", { count: "exact", head: true })
      .eq("event_type", "water")
      .eq("water_state", "drained")
      .eq("crop_cycles.status", "active")
      .then(({ count }) => setDrySpellEvents(count ?? 0));
    supabase
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .eq("alert_type", "possible_burn")
      .gte("detected_date", d30)
      .then(({ count }) => setFireAlerts30d(count ?? 0));
  }, []);

  const filtered = farms.filter((f) => {
    if (provinceFilter !== "all" && f.province !== provinceFilter) return false;
    if (cropFilter !== "all" && f.crop_type !== cropFilter) return false;
    return true;
  });

  const mappable = filtered.filter((f) => (f.latitude && f.longitude) || f.boundary_geojson);
  const drawFarm = draw ? farms.find((f) => f.id === draw) ?? null : null;

  // Season scrubber: one frame per optical acquisition date; radar follows the same date.
  const dates = frameDates(healthRows);
  const frame = frameDate && dates.includes(frameDate) ? frameDate : dates[dates.length - 1] ?? null;
  const healthAt = frame ? readingsAt(healthRows, frame) : new Map<string, HealthRow>();
  const waterAt = frame ? readingsAt(waterRows, frame) : new Map<string, WaterLite>();
  const parcels = parcelFeatures(
    mappable.map((f) => ({
      id: f.id, farm_name: f.farm_name, farmer: f.farmers?.full_name ?? null,
      latitude: f.latitude, longitude: f.longitude, area_hectares: f.area_hectares, boundary_geojson: f.boundary_geojson,
    })),
    healthAt,
    waterAt,
    colorMode,
  );
  const listed = mappable.filter((f) => {
    const q = listFilter.trim().toLowerCase();
    if (!q) return true;
    return f.farm_name.toLowerCase().includes(q) || (f.farmers?.full_name ?? "").toLowerCase().includes(q) || f.farm_code.toLowerCase().includes(q);
  });

  useEffect(() => {
    if (!playing || dates.length < 2) return;
    const id = setInterval(() => {
      setFrameDate((cur) => {
        const i = cur ? dates.indexOf(cur) : dates.length - 1;
        return dates[(i + 1) % dates.length];
      });
    }, 900);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, dates.join("|")]);

  const onPolygonDrawn = async (latlngs: { lat: number; lng: number }[]) => {
    if (!drawFarm) return;
    const ring = latlngs.map(({ lat, lng }) => [lng, lat] as [number, number]);
    const problem = validatePolygon(ring);
    if (problem) {
      toast.error(problem);
      return;
    }
    const geo = toPolygonGeo(latlngs);
    const ha = Math.round(polygonAreaHa(geo) * 100) / 100;

    // Warn, do not block. Parcels legitimately abut, GPS is metres-accurate,
    // and a field officer standing in the right field must still be able to
    // save. The check is a prompt to look, not a verdict.
    const clash = farms
      .filter((f) => f.id !== drawFarm.id && f.boundary_geojson)
      .map((f) => ({ f, kind: polygonsOverlap(geo, f.boundary_geojson as unknown as PolygonGeo) }))
      .find((r) => r.kind !== null);
    if (clash) {
      toast.warning(`This boundary overlaps ${clash.f.farm_code}.`, {
        description:
          clash.kind === "crosses"
            ? "The two parcels share ground. Check which farmer actually works it."
            : "One parcel is drawn inside the other — this may be the same field registered twice.",
      });
    }

    const { error } = await supabase
      .from("farms")
      .update({ boundary_geojson: geo as unknown as Farm["boundary_geojson"] })
      .eq("id", drawFarm.id);
    if (!ok(error, "Save boundary")) return;
    toast.success(`Boundary saved for ${drawFarm.farm_name} (≈ ${ha} ha).`);
    if (
      ha > 0 &&
      (await confirm({
        title: `Set parcel area to ${ha} ha?`,
        description: `Measured from the boundary you drew. Current value: ${drawFarm.area_hectares ?? "not set"}.`,
        confirmLabel: "Update area",
      }))
    ) {
      const { error: areaErr } = await supabase
        .from("farms")
        .update({ area_hectares: ha })
        .eq("id", drawFarm.id);
      if (ok(areaErr, "Update area")) toast.success("Area updated.");
    }
    loadFarms();
    navigate({ search: {} });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{t("zone.title")}</h1>
        <div className="flex gap-2">
          {hasAnyRole(["admin", "manager"]) && (
            <>
              <Button variant="outline" size="sm" disabled={refreshing} onClick={refreshHealth}>
                {refreshing ? t("map.refreshing") : t("map.refreshHealth")}
              </Button>
              <Button variant="outline" size="sm" disabled={scanningWater} onClick={refreshWater}>
                {scanningWater ? t("map.scanning") : t("map.radarScan")}
              </Button>
            </>
          )}
          <Select value={provinceFilter} onValueChange={setProvinceFilter}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("map.allProvinces")}</SelectItem>
              {provinces.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={cropFilter} onValueChange={setCropFilter}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("map.allCrops")}</SelectItem>
              {["rice","cassava","corn","sugarcane","rubber","pepper","vegetable","fruit","other"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!drawFarm && (() => {
        const zs = zoneStats({ farms: filtered, health: healthRows, drySpellEvents, fireAlerts30d });
        const tiles = [
          { icon: MapPinIcon, value: zs.parcelsMonitored, label: t("zone.parcelsMonitored"), color: "text-chart-2" },
          { icon: Ruler, value: zs.hectares.toLocaleString(), label: t("zone.hectares"), color: "text-chart-3" },
          { icon: Leaf, value: `${zs.healthy} / ${zs.stressed}`, label: `${t("zone.healthy")} / ${t("zone.stressed")}`, color: "text-chart-2" },
          { icon: Droplets, value: zs.drySpells, label: t("zone.drySpells"), color: "text-chart-1" },
          { icon: Flame, value: zs.fires30d, label: t("zone.fires30d"), color: "text-destructive" },
        ];
        return (
          <div className="space-y-1.5">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {tiles.map((tile) => (
                <Card key={tile.label}>
                  <CardContent className="p-3">
                    <tile.icon className={`h-4 w-4 ${tile.color}`} />
                    <div className="mt-1 text-xl font-bold leading-none">{tile.value}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{tile.label}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t("zone.awdNote")}</p>
          </div>
        );
      })()}

      {drawFarm && (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
          Drawing boundary for <span className="font-medium">{drawFarm.farm_name}</span> — click the
          field corners on the satellite image; click the first point again to finish.
          <Button size="sm" variant="ghost" className="ml-2" onClick={() => navigate({ search: {} })}>
            Cancel
          </Button>
        </div>
      )}

      {drawFarm ? (
        <Card>
          <CardContent className="p-0">
            <ClientOnly fallback={<div className="h-[500px] flex items-center justify-center text-muted-foreground">Loading map...</div>}>
              <MapComponent farms={mappable} hotspots={hotspots} health={health} drawFarm={drawFarm} onPolygonDrawn={onPolygonDrawn} />
            </ClientOnly>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
          <Card className="order-2 lg:order-1">
            <CardContent className="p-0">
              <div className="border-b border-border p-2">
                <Input value={listFilter} onChange={(e) => setListFilter(e.target.value)} placeholder={t("map.findParcel")} className="h-8 text-sm" />
              </div>
              <div className="max-h-[520px] overflow-auto">
                {listed.map((f) => {
                  const hr = healthAt.get(f.id);
                  const wr = waterAt.get(f.id);
                  const active = selectedId === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setSelectedId(f.id)}
                      className={`flex w-full items-center gap-2 border-b border-border/60 px-3 py-2 text-left hover:bg-accent/40 ${active ? "bg-accent/60" : ""}`}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: parcels.features.find((p) => p.properties.id === f.id)?.properties.c ?? "#64748b" }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px]">{f.farm_name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{f.farmers?.full_name ?? "—"}</span>
                      </span>
                      <span className="num text-[11px] text-muted-foreground">
                        {colorMode === "ndvi" ? (hr ? hr.ndvi_mean.toFixed(2) : "—") : (wr ? wr.state : "—")}
                      </span>
                    </button>
                  );
                })}
                {listed.length === 0 && <p className="p-4 text-sm text-muted-foreground">{t("map.noParcels")}</p>}
              </div>
            </CardContent>
          </Card>

          <Card className="order-1 lg:order-2 overflow-hidden">
            <CardContent className="p-0">
              <ClientOnly fallback={<div className="h-[560px] flex items-center justify-center text-muted-foreground">Loading map...</div>}>
                <EstateMap
                  mode="explore"
                  parcels={parcels}
                  hotspots={hotspots}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  layers={layersOn}
                  fit="estate"
                  className="h-[560px] w-full"
                  fallback={<MapComponent farms={mappable} hotspots={hotspots} health={health} drawFarm={null} onPolygonDrawn={onPolygonDrawn} />}
                />
              </ClientOnly>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-3 py-2 text-[12px]">
                <div className="flex overflow-hidden rounded-sm border border-border">
                  {(["ndvi", "water"] as ColorMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setColorMode(m)}
                      className={`px-2.5 py-1 ${colorMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {m === "ndvi" ? t("map.vigour") : t("map.water")}
                    </button>
                  ))}
                </div>
                {(["canals", "roads", "blocks", "own"] as const).map((k) => (
                  <label key={k} className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
                    <input type="checkbox" checked={layersOn[k]} onChange={(e) => setLayersOn({ ...layersOn, [k]: e.target.checked })} className="accent-[var(--primary)]" />
                    {t(k === "canals" ? "map.canals" : k === "roads" ? "map.roads" : k === "blocks" ? "map.blocks" : "map.ownPlots")}
                  </label>
                ))}
                {dates.length > 1 && (
                  <div className="ml-auto flex items-center gap-2">
                    <button type="button" onClick={() => setPlaying((p) => !p)} className="text-primary" aria-label={playing ? t("map.pause") : t("map.play")}>
                      {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={dates.length - 1}
                      value={frame ? dates.indexOf(frame) : dates.length - 1}
                      onChange={(e) => { setPlaying(false); setFrameDate(dates[Number(e.target.value)]); }}
                      className="w-40 accent-[var(--primary)]"
                    />
                    <span className="num w-[84px] text-muted-foreground">{frame ?? "—"}</span>
                  </div>
                )}
                <span className="num hidden text-[10px] uppercase tracking-wide text-muted-foreground/70 xl:inline">{t("map.orbitHint")}</span>
              </div>
              <div className="flex flex-wrap items-center gap-4 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                {(colorMode === "ndvi"
                  ? [["#4ade80", "Healthy (0.6+)"], ["#f59e0b", "Moderate (0.4–0.6)"], ["#ef4444", "Poor (under 0.4)"], ["#64748b", t("map.noReading")]]
                  : [["#7dd3fc", "Flooded"], ["#4ade80", "Drained"], ["#94a3b8", "Uncertain"], ["#64748b", t("map.noReading")]]
                ).map(([colour, label]) => (
                  <span key={label} className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: colour }} />
                    {label}
                  </span>
                ))}
                <span className="ml-auto">{t("map.heightNote")}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        Showing {mappable.length} parcels with a location out of {filtered.length} total filtered parcels.
        {" "}Fire markers: {hotspots.length} satellite hotspot(s) in the BRM zone, last 5 days.
      </p>
      {confirmDialog}
    </div>
  );
}

interface MapComponentProps {
  farms: FarmWithFarmer[];
  hotspots: Hotspot[];
  health: Map<string, HealthRow>;
  drawFarm: FarmWithFarmer | null;
  onPolygonDrawn: (latlngs: { lat: number; lng: number }[]) => void;
}

function MapComponent({ farms, hotspots, health, drawFarm, onPolygonDrawn }: MapComponentProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  // Keep the latest callback without re-initialising the map.
  const onPolygonDrawnRef = useRef(onPolygonDrawn);
  onPolygonDrawnRef.current = onPolygonDrawn;
  // Survives the teardown/rebuild the effect does when its inputs change, so a
  // refresh does not throw away where the user was looking.
  const viewRef = useRef<{ center: [number, number]; zoom: number } | null>(null);
  // Only a view the user actually arrived at is worth restoring: not the initial
  // wide zoom before parcels load, and not the close-up used while drawing.
  const fittedRef = useRef(false);

  useEffect(() => {
    let L: typeof import("leaflet");

    async function init() {
      // Use the mutable default export, not the frozen module namespace —
      // leaflet-draw must be able to attach L.Draw to this object.
      const leafletModule = await import("leaflet");
      L = (leafletModule as { default?: typeof import("leaflet") }).default ?? leafletModule;
      await import("leaflet/dist/leaflet.css");

      if (!mapRef.current || mapInstanceRef.current) return;

      const map = L.map(mapRef.current).setView([BURN_ZONE.latitude, BURN_ZONE.longitude], 12);
      mapInstanceRef.current = map;

      const satellite = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics", maxZoom: 19 },
      );
      const streets = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      });
      satellite.addTo(map);
      L.control.layers({ Satellite: satellite, Streets: streets }, {}, { position: "topright" }).addTo(map);

      const defaultIcon = L.icon({
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
      });

      const today = new Date().toISOString().slice(0, 10);
      const healthHtml = (farm: FarmWithFarmer) => {
        const r = health.get(farm.id);
        if (!r) {
          return farm.boundary_geojson
            ? `<span style="color:#64748b">No satellite reading yet</span><br/>`
            : `<span style="color:#64748b">Draw the boundary to unlock satellite health</span><br/>`;
        }
        const age = daysBetween(r.reading_date, today);
        return (
          `Vegetation: <strong>${vegetationLabel(r.ndvi_mean)}</strong> · ` +
          `Water: <strong>${waterLabel(r.ndmi_mean)}</strong><br/>` +
          `<small style="color:#64748b">Read ${age} day(s) ago (${r.reading_date}), ` +
          `NDVI ${r.ndvi_mean.toFixed(2)} · NDMI ${r.ndmi_mean.toFixed(2)}</small><br/>`
        );
      };

      const popupHtml = (farm: FarmWithFarmer) => `
        <div style="min-width:170px">
          <strong>${farm.farm_name}</strong><br/>
          <small>${farm.farm_code}</small><br/>
          ${healthHtml(farm)}
          Farmer: ${farm.farmers?.full_name || "—"}<br/>
          Crop: ${farm.crop_type || "—"}<br/>
          Area: ${farm.area_hectares || "—"} ha<br/>
          <a href="/farms/${farm.id}" style="color:#3b82f6">View Details →</a>
        </div>`;

      farms.forEach((farm) => {
        let boundaryDrawn = false;
        if (farm.boundary_geojson) {
          try {
            const colour = healthColor(health.get(farm.id)?.ndvi_mean);
            const layer = L.geoJSON(farm.boundary_geojson as unknown as GeoJSON.GeoJsonObject, {
              style: { color: colour, weight: 2, fillColor: colour, fillOpacity: 0.25 },
              interactive: !drawFarm,
            }).addTo(map);
            layer.bindPopup(popupHtml(farm));
            boundaryDrawn = true;
          } catch {
            // invalid geojson — fall through to the pin
          }
        }
        if (!boundaryDrawn && farm.latitude && farm.longitude) {
          L.marker([farm.latitude, farm.longitude], { icon: defaultIcon, interactive: !drawFarm })
            .addTo(map)
            .bindPopup(popupHtml(farm));
        }
      });

      // BRM estate: the surveyed lease boundary (estate survey KML, 07.04.24 —
      // estate survey), served as a static GeoJSON layer.
      // While drawing, every other layer must not swallow map clicks.
      fetch("/geo/estate.geojson")
        .then((r) => (r.ok ? r.json() : null))
        .then((estate: { features?: { properties?: { area_ha?: number; surveyed?: string } }[] } | null) => {
          if (!estate || !mapInstanceRef.current || mapInstanceRef.current !== map) return;
          const props = estate.features?.[0]?.properties ?? {};
          const ha = Math.round(props.area_ha ?? 0);
          L.geoJSON(estate as unknown as GeoJSON.GeoJsonObject, {
            style: { color: "#16a34a", weight: 2.5, fillColor: "#16a34a", fillOpacity: 0.06 },
            interactive: !drawFarm,
          })
            .addTo(map)
            .bindPopup(
              `<strong>BRM Agro — estate</strong><br/>Surveyed lease boundary ≈ ${ha.toLocaleString()} ha (survey ${props.surveyed ?? "2024-04-07"})`,
            )
            .bindTooltip("BRM AGRO ESTATE", {
              permanent: true,
              direction: "center",
              className: "brm-zone-label",
            });
        })
        .catch(() => undefined);

      // Estate centre — the point the burn-watch radius and GPS sanity checks measure from.
      L.circleMarker([BURN_ZONE.latitude, BURN_ZONE.longitude], {
        radius: 7,
        color: "#14532d",
        fillColor: "#16a34a",
        fillOpacity: 1,
        weight: 2,
        interactive: !drawFarm,
      })
        .addTo(map)
        .bindPopup("<strong>BRM Agro Co., Ltd</strong><br/>Estate centre — Kampong Thom<br/>Burn watch radius 6 km")
        .bindTooltip("BRM AGRO", {
          permanent: true,
          direction: "top",
          offset: L.point(0, -8),
          className: "brm-mill-label",
        });

      // Fire hotspots from FIRMS, last 5 days.
      hotspots.forEach((h) => {
        L.circleMarker([h.latitude, h.longitude], {
          radius: 8,
          color: "#dc2626",
          fillColor: "#ef4444",
          fillOpacity: 0.7,
          interactive: !drawFarm,
        })
          .addTo(map)
          .bindPopup(`
            <div style="min-width:150px">
              <strong>🔥 Fire detection</strong><br/>
              Date: ${h.acq_date} ${h.acq_time.slice(0, 2)}:${h.acq_time.slice(2)} UTC<br/>
              Confidence: ${CONFIDENCE_LABEL[h.confidence] || h.confidence}<br/>
              Power: ${h.frp} MW<br/>
              Satellite: ${h.satellite}
            </div>
          `);
      });

      if (drawFarm) {
        if (drawFarm.latitude && drawFarm.longitude) {
          map.setView([drawFarm.latitude, drawFarm.longitude], 16);
        } else {
          map.setView([BURN_ZONE.latitude, BURN_ZONE.longitude], 14);
        }
        // Plain click-to-add-vertex drawing. No plugin: works the same with a
        // mouse and a finger, and stays testable.
        const vertices: L.LatLng[] = [];
        let preview: L.Polygon | null = null;
        let vertexMarkers: L.CircleMarker[] = [];
        map.getContainer().style.cursor = "crosshair";

        const redraw = () => {
          preview?.remove();
          vertexMarkers.forEach((m) => m.remove());
          vertexMarkers = vertices.map((ll, i) =>
            L.circleMarker(ll, {
              radius: i === 0 ? 7 : 5,
              color: "#f59e0b",
              fillColor: i === 0 ? "#f59e0b" : "#fff",
              fillOpacity: 1,
              interactive: false,
            }).addTo(map),
          );
          preview =
            vertices.length >= 2
              ? L.polygon(vertices, {
                  color: "#f59e0b",
                  weight: 2,
                  dashArray: "6 4",
                  fillOpacity: 0.1,
                  interactive: false,
                }).addTo(map)
              : null;
        };

        map.on("click", (e: L.LeafletMouseEvent) => {
          // Clicking near the first vertex again closes the shape.
          if (vertices.length >= 3) {
            const first = map.latLngToContainerPoint(vertices[0]);
            const here = map.latLngToContainerPoint(e.latlng);
            if (first.distanceTo(here) < 12) {
              map.getContainer().style.cursor = "";
              onPolygonDrawnRef.current(vertices.map(({ lat, lng }) => ({ lat, lng })));
              return;
            }
          }
          vertices.push(e.latlng);
          redraw();
        });
      } else if (viewRef.current) {
        map.setView(viewRef.current.center, viewRef.current.zoom);
      } else if (farms.length > 0) {
        const bounds = L.latLngBounds([[BURN_ZONE.latitude, BURN_ZONE.longitude]]);
        farms.forEach((f) => {
          if (f.latitude && f.longitude) bounds.extend([f.latitude, f.longitude]);
          const poly = f.boundary_geojson as { coordinates?: [number, number][][] } | null;
          poly?.coordinates?.[0]?.forEach(([lng, lat]) => bounds.extend([lat, lng]));
        });
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
        fittedRef.current = true;
      }
    }

    init();

    return () => {
      if (mapInstanceRef.current) {
        if (fittedRef.current && !drawFarm) {
          const c = mapInstanceRef.current.getCenter();
          viewRef.current = { center: [c.lat, c.lng], zoom: mapInstanceRef.current.getZoom() };
        }
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [farms, hotspots, health, drawFarm?.id]);

  return <div ref={mapRef} style={{ height: "500px", width: "100%" }} />;
}
