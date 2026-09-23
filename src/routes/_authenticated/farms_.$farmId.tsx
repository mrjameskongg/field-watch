import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { daysBetween, healthColor, vegetationLabel, waterLabel, type HealthRow } from "@/lib/health-core";
import { SeasonCard, SeasonLedger } from "@/components/season";
import { AwdCard, WaterCheckCard, useWaterCrossCheck } from "@/components/water-check";
import { useI18n } from "@/lib/i18n";
import { alertStatusLabel, alertTypeLabel, humanize } from "@/lib/labels";

type Farm = Database["public"]["Tables"]["farms"]["Row"];

export const Route = createFileRoute("/_authenticated/farms_/$farmId")({
  component: FarmDetailPage,
});

function FarmDetailPage() {
  const { t } = useI18n();
  const { farmId } = Route.useParams();
  // Shared by WaterCheckCard and AwdCard so the radar cross-check is fetched once.
  const waterCrossCheck = useWaterCrossCheck(farmId);
  const [farm, setFarm] = useState<(Farm & { farmers?: { full_name: string; farmer_code: string } | null }) | null>(null);
  const [visits, setVisits] = useState<Database["public"]["Tables"]["field_visits"]["Row"][]>([]);
  const [alerts, setAlerts] = useState<Database["public"]["Tables"]["alerts"]["Row"][]>([]);
  const [health, setHealth] = useState<HealthRow[]>([]);
  // Bumped by the season card after any mutation so the ledger tab refetches.
  const [seasonVersion, setSeasonVersion] = useState(0);

  useEffect(() => {
    supabase.from("farms").select("*, farmers(full_name, farmer_code)").eq("id", farmId).single().then(({ data }) => setFarm(data));
    supabase.from("field_visits").select("*").eq("farm_id", farmId).order("visit_date", { ascending: false }).then(({ data }) => setVisits(data || []));
    supabase.from("alerts").select("*").eq("farm_id", farmId).order("created_at", { ascending: false }).then(({ data }) => setAlerts(data || []));

    const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    supabase
      .from("parcel_health")
      .select("farm_id, reading_date, ndvi_mean, ndmi_mean, cloud_pct")
      .eq("farm_id", farmId)
      .gte("reading_date", since)
      .order("reading_date", { ascending: true })
      .then(({ data }) => setHealth((data ?? []) as HealthRow[]));
  }, [farmId]);

  if (!farm)
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/farms"><Button variant="ghost" size="icon" title="Back to farms" aria-label="Back to farms"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <div>
          <h1 className="text-2xl font-bold">{farm.farm_name}</h1>
          <p className="text-sm text-muted-foreground">
            {farm.farm_code}
            {farm.farmers && <> · {farm.farmers.full_name}</>}
            {farm.area_hectares != null && <> · {farm.area_hectares} ha</>}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link to="/map" search={{ draw: farm.id }}>
            <Button variant="outline" size="sm">
              {farm.boundary_geojson ? t("parcel.redrawBoundary") : t("parcel.drawBoundary")}
            </Button>
          </Link>
          <Badge
            variant="secondary"
            className={`capitalize ${
              {
                low: "bg-chart-2/10 text-chart-2",
                medium: "bg-chart-4/10 text-chart-4",
                high: "bg-chart-1/10 text-chart-1",
                critical: "bg-destructive/10 text-destructive",
              }[farm.risk_level || "low"]
            }`}
          >
            {t(`risk.${farm.risk_level || "low"}` as Parameters<typeof t>[0])} {t("parcel.risk")}
          </Badge>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("parcel.satelliteHealth")}</CardTitle>
        </CardHeader>
        <CardContent>
          {!farm.boundary_geojson ? (
            <p className="text-sm text-muted-foreground">
              Draw the boundary to unlock satellite health — readings are measured inside the parcel outline.
            </p>
          ) : health.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No satellite reading yet. Readings appear once the weekly scan runs and a clear pass comes
              over — cloudy weeks produce none.
            </p>
          ) : (
            (() => {
              const latest = health[health.length - 1];
              const age = daysBetween(latest.reading_date, new Date().toISOString().slice(0, 10));
              return (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <span className="text-lg font-semibold">
                      {t("parcel.vegetation")}:{" "}
                      <span style={{ color: healthColor(latest.ndvi_mean) }}>
                        {t(`health.veg.${vegetationLabel(latest.ndvi_mean)}` as Parameters<typeof t>[0])}
                      </span>
                    </span>
                    <span className="text-lg font-semibold">
                      {t("parcel.water")}: {t(`health.water.${waterLabel(latest.ndmi_mean)}` as Parameters<typeof t>[0])}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      NDVI {latest.ndvi_mean.toFixed(2)} · NDMI {latest.ndmi_mean.toFixed(2)} ·{" "}
                      {latest.cloud_pct.toFixed(0)}% {t("parcel.cloud")}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("parcel.lastReading").replace("{n}", String(age)).replace("{date}", latest.reading_date)}
                  </p>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={health.map((r) => ({ date: r.reading_date.slice(5), ndvi: r.ndvi_mean, ndmi: r.ndmi_mean }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" fontSize={12} />
                      <YAxis
                        domain={[(dataMin: number) => Math.min(-0.2, dataMin), 1]}
                        ticks={[-0.2, 0, 0.2, 0.4, 0.6, 0.8, 1]}
                        tickFormatter={(v: number) => v.toFixed(1)}
                        fontSize={12}
                      />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="ndvi" name={t("parcel.legendVeg")} stroke="#16a34a" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="ndmi" name={t("parcel.legendWater")} stroke="#0ea5e9" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              );
            })()
          )}
        </CardContent>
      </Card>

      <WaterCheckCard farmId={farmId} data={waterCrossCheck} />

      <AwdCard farmId={farmId} crossCheckData={waterCrossCheck} />

      <SeasonCard
        farmId={farmId}
        farmCropType={farm.crop_type}
        onChanged={() => setSeasonVersion((v) => v + 1)}
      />

      <Tabs defaultValue="info">
        <TabsList>
          <TabsTrigger value="info">{t("parcel.tabInfo")}</TabsTrigger>
          <TabsTrigger value="season">{t("parcel.tabSeason")}</TabsTrigger>
          <TabsTrigger value="visits">{t("parcel.tabVisits")} ({visits.length})</TabsTrigger>
          <TabsTrigger value="alerts">{t("parcel.tabAlerts")} ({alerts.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="season">
          <SeasonLedger farmId={farmId} key={seasonVersion} />
        </TabsContent>

        <TabsContent value="info">
          <Card>
            <CardContent className="p-6 grid md:grid-cols-2 gap-4">
              {[
                ["Farmer", farm.farmers ? `${farm.farmers.full_name} (${farm.farmers.farmer_code})` : "—"],
                ["Province", farm.province],
                ["District", farm.district],
                ["Commune", farm.commune],
                ["Village", farm.village],
                ["Latitude", farm.latitude],
                ["Longitude", farm.longitude],
                ["Area (ha)", farm.area_hectares],
                ["Crop Type", farm.crop_type],
                ["Status", humanize(farm.status)],
                ["Planting Date", farm.planting_date],
                ["Notes", farm.notes],
              ].map(([label, val]) => (
                <div key={label as string}>
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="text-sm font-medium capitalize">{String(val ?? "—")}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="visits">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Crop Condition</TableHead><TableHead>Comments</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {visits.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>{v.visit_date}</TableCell>
                    <TableCell>{humanize(v.visit_type)}</TableCell>
                    <TableCell>{v.crop_condition || "—"}</TableCell>
                    <TableCell className="max-w-xs truncate">{v.comments || "—"}</TableCell>
                  </TableRow>
                ))}
                {visits.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No visits</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="alerts">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Type</TableHead><TableHead>Severity</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead><TableHead>What happened</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {alerts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{alertTypeLabel(a.alert_type)}</TableCell>
                    <TableCell>{humanize(a.severity)}</TableCell>
                    <TableCell>{alertStatusLabel(a.status)}</TableCell>
                    <TableCell>{new Date(a.detected_date).toLocaleDateString()}</TableCell>
                    {/* The satellite alerts carry the reason and what to do about it;
                        without this column the row is a label nobody can act on. The
                        [S2 ...] marker is a dedupe key, not something to read. */}
                    <TableCell className="max-w-md">
                      <div className="text-sm">{a.description?.replace(/\s*\[S2 [^\]]+\]/, "") || "—"}</div>
                      {a.recommended_action && (
                        <div className="text-xs text-muted-foreground mt-0.5">{a.recommended_action}</div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {alerts.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No alerts</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
