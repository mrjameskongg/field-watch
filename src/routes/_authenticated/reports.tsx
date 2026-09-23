// Reports read aggregate views, not raw tables.
//
// This page used to select every farmer, farm and alert unfiltered and reduce
// them in the browser: slow, silently truncated at PostgREST's row cap, and
// arithmetic nobody could audit. The sums now live in
// supabase/migrations/20260827170000_report_views.sql. The two row listings
// stay as table reads, because they are listings rather than aggregates.

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ok } from "@/lib/supabase-helpers";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { RowCapNotice } from "@/components/row-cap-notice";
import { toCsv, type CsvColumn } from "@/lib/csv";
import { capped, FETCH_LIMIT } from "@/lib/query-limits";
import {
  REPORT_COLUMNS,
  type AlertSummary,
  type AreaByProvince,
  type DeliveryBySeason,
  type SettlementSummary,
} from "@/lib/report-core";
import { asCurrency, fmtMoney } from "@/lib/money-core";
import { alertStatusLabel, alertTypeLabel, humanize } from "@/lib/labels";

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsPage,
});

type FarmerRow = { id: string; farmer_code: string; full_name: string; province: string | null; status: string; crop_type: string | null };
type FarmRow = { id: string; farm_code: string; farm_name: string; province: string | null; area_hectares: number | null; crop_type: string | null; status: string };
type AlertRow = { id: string; alert_type: string; severity: string; status: string; detected_date: string };

const FARMER_COLUMNS: CsvColumn<FarmerRow>[] = [
  { key: "farmer_code", get: (r) => r.farmer_code },
  { key: "full_name", get: (r) => r.full_name },
  { key: "province", get: (r) => r.province },
  { key: "status", get: (r) => r.status },
  { key: "crop_type", get: (r) => r.crop_type },
];

const FARM_COLUMNS: CsvColumn<FarmRow>[] = [
  { key: "farm_code", get: (r) => r.farm_code },
  { key: "farm_name", get: (r) => r.farm_name },
  { key: "province", get: (r) => r.province },
  { key: "area_hectares", get: (r) => r.area_hectares },
  { key: "crop_type", get: (r) => r.crop_type },
  { key: "status", get: (r) => r.status },
];

const ALERT_COLUMNS: CsvColumn<AlertRow>[] = [
  { key: "alert_type", get: (r) => r.alert_type },
  { key: "severity", get: (r) => r.severity },
  { key: "status", get: (r) => r.status },
  { key: "detected_date", get: (r) => r.detected_date },
];

const num = (v: number | null | undefined) => (v ?? 0).toLocaleString();
const money = (v: number | null | undefined, currency: string | null | undefined) => fmtMoney(v ?? 0, asCurrency(currency));

function ReportsPage() {
  const [farmers, setFarmers] = useState<FarmerRow[]>([]);
  const [farms, setFarms] = useState<FarmRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [area, setArea] = useState<AreaByProvince[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryBySeason[]>([]);
  const [settlements, setSettlements] = useState<SettlementSummary[]>([]);
  const [alertSummary, setAlertSummary] = useState<AlertSummary[]>([]);
  const [truncated, setTruncated] = useState<Record<string, boolean>>({});

  useEffect(() => {
    supabase.from("farmers").select("id, farmer_code, full_name, province, status, crop_type").order("full_name").limit(FETCH_LIMIT)
      .then(({ data, error }) => {
        if (!ok(error, "Load farmers")) return;
        const page = capped((data ?? []) as FarmerRow[]);
        setFarmers(page.rows);
        setTruncated((t) => ({ ...t, farmers: page.truncated }));
      });
    supabase.from("farms").select("id, farm_code, farm_name, province, area_hectares, crop_type, status").order("farm_name").limit(FETCH_LIMIT)
      .then(({ data, error }) => {
        if (!ok(error, "Load farms")) return;
        const page = capped((data ?? []) as FarmRow[]);
        setFarms(page.rows);
        setTruncated((t) => ({ ...t, farms: page.truncated }));
      });
    supabase.from("alerts").select("id, alert_type, severity, status, detected_date").order("detected_date", { ascending: false }).limit(FETCH_LIMIT)
      .then(({ data, error }) => {
        if (!ok(error, "Load alerts")) return;
        const page = capped((data ?? []) as AlertRow[]);
        setAlerts(page.rows);
        setTruncated((t) => ({ ...t, alerts: page.truncated }));
      });

    // Aggregates. Column names are pinned by report-core.ts and the migration
    // 20260827170000_report_views.sql together.
    supabase.from("v_area_by_province").select("*")
      .then(({ data, error }) => { if (ok(error, "Load area by province")) setArea((data ?? []) as AreaByProvince[]); });
    supabase.from("v_delivery_by_season").select("*")
      .then(({ data, error }) => { if (ok(error, "Load deliveries by season")) setDeliveries((data ?? []) as DeliveryBySeason[]); });
    supabase.from("v_settlement_summary").select("*")
      .then(({ data, error }) => { if (ok(error, "Load settlement summary")) setSettlements((data ?? []) as SettlementSummary[]); });
    supabase.from("v_alert_summary").select("*")
      .then(({ data, error }) => { if (ok(error, "Load alert summary")) setAlertSummary((data ?? []) as AlertSummary[]); });
  }, []);

  // A count of rows the page already holds does not earn a view.
  const farmsByCrop = farms.reduce((acc, f) => {
    const c = f.crop_type || "other";
    acc[c] = (acc[c] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const stamp = new Date().toISOString().slice(0, 10);

  // Built in the browser; the file never round-trips to a server.
  function exportCsv<T>(rows: T[], columns: CsvColumn<T>[], name: string) {
    const url = URL.createObjectURL(new Blob([toCsv(rows, columns)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const ExportButton = <T,>({ rows, columns, name }: { rows: T[]; columns: CsvColumn<T>[]; name: string }) => (
    <div className="flex justify-end p-2">
      <Button variant="outline" size="sm" disabled={rows.length === 0} onClick={() => exportCsv(rows, columns, name)}>
        <Download className="h-4 w-4 mr-1" />
        Export
      </Button>
    </div>
  );

  const empty = (colSpan: number) => (
    <TableRow>
      <TableCell colSpan={colSpan} className="text-center text-muted-foreground py-8">
        Nothing recorded yet.
      </TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Reports</h1>

      <Tabs defaultValue="farmers">
        <TabsList className="flex-wrap">
          <TabsTrigger value="farmers">All Farmers</TabsTrigger>
          <TabsTrigger value="farms">All Farms</TabsTrigger>
          <TabsTrigger value="area">Area by Province</TabsTrigger>
          <TabsTrigger value="crop">Farms by Crop</TabsTrigger>
          <TabsTrigger value="deliveries">Deliveries by Season</TabsTrigger>
          <TabsTrigger value="settlements">Settlements</TabsTrigger>
          <TabsTrigger value="alertSummary">Alert Summary</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
        </TabsList>

        <TabsContent value="farmers">
          <Card><CardContent className="p-0">
            <RowCapNotice show={!!truncated.farmers} noun="farmers" />
            <ExportButton rows={farmers} columns={FARMER_COLUMNS} name="farmers" />
            <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow>
                <TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Province</TableHead><TableHead>Status</TableHead><TableHead>Crop</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {farmers.length === 0 && empty(5)}
                {farmers.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell>{f.farmer_code}</TableCell>
                    <TableCell>{f.full_name}</TableCell>
                    <TableCell>{f.province || "—"}</TableCell>
                    <TableCell>{humanize(f.status)}</TableCell>
                    <TableCell className="capitalize">{f.crop_type || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="farms">
          <Card><CardContent className="p-0">
            <RowCapNotice show={!!truncated.farms} noun="farms" />
            <ExportButton rows={farms} columns={FARM_COLUMNS} name="farms" />
            <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow>
                <TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Province</TableHead><TableHead>Area (ha)</TableHead><TableHead>Crop</TableHead><TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {farms.length === 0 && empty(6)}
                {farms.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell>{f.farm_code}</TableCell>
                    <TableCell>{f.farm_name}</TableCell>
                    <TableCell>{f.province || "—"}</TableCell>
                    <TableCell className="tabular-nums">{f.area_hectares ?? "—"}</TableCell>
                    <TableCell className="capitalize">{f.crop_type || "—"}</TableCell>
                    <TableCell>{humanize(f.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="area">
          <Card><CardContent className="p-0">
            <ExportButton rows={area} columns={REPORT_COLUMNS.area} name="area-by-province" />
            <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow>
                <TableHead>Province</TableHead><TableHead>Farms</TableHead><TableHead>Mapped</TableHead><TableHead>Total Area (ha)</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {area.length === 0 && empty(4)}
                {area.map((r) => (
                  <TableRow key={r.province}>
                    <TableCell>{r.province}</TableCell>
                    <TableCell className="tabular-nums">{num(r.farm_count)}</TableCell>
                    {/* Mapped against total is the number that decides whether a
                        due-diligence pack can be built for this province. */}
                    <TableCell className="tabular-nums">{num(r.mapped_count)}/{num(r.farm_count)}</TableCell>
                    <TableCell className="tabular-nums">{num(Math.round(Number(r.total_hectares) * 100) / 100)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="crop">
          <Card><CardContent className="p-0">
            {/* Counted from the farms list above, so it inherits that cap —
                a truncated list would undercount every crop silently. */}
            <RowCapNotice show={!!truncated.farms} noun="farms (so these counts are short)" />
            <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>Crop Type</TableHead><TableHead>Farm Count</TableHead></TableRow></TableHeader>
              <TableBody>
                {Object.keys(farmsByCrop).length === 0 && empty(2)}
                {Object.entries(farmsByCrop).sort(([, a], [, b]) => b - a).map(([c, n]) => (
                  <TableRow key={c}><TableCell className="capitalize">{c}</TableCell><TableCell className="tabular-nums">{n}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table></div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="deliveries">
          <Card><CardContent className="p-0">
            <ExportButton rows={deliveries} columns={REPORT_COLUMNS.deliveries} name="deliveries-by-season" />
            <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow>
                <TableHead>Season</TableHead><TableHead>Crop</TableHead><TableHead>Currency</TableHead><TableHead>Deliveries</TableHead><TableHead>Total (kg)</TableHead><TableHead>Value</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {deliveries.length === 0 && empty(6)}
                {deliveries.map((r) => (
                  <TableRow key={`${r.season_label}-${r.crop_type}-${r.currency}`}>
                    <TableCell>
                      {r.season_label}
                      {r.season_closed && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">closed</span>}
                    </TableCell>
                    <TableCell className="capitalize">{r.crop_type}</TableCell>
                    <TableCell className="font-mono text-xs">{asCurrency(r.currency)}</TableCell>
                    <TableCell className="tabular-nums">{num(r.delivery_count)}</TableCell>
                    <TableCell className="tabular-nums">{num(r.total_kg)}</TableCell>
                    <TableCell className="tabular-nums">{money(r.total_value, r.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="settlements">
          <Card><CardContent className="p-0">
            <ExportButton rows={settlements} columns={REPORT_COLUMNS.settlements} name="settlements" />
            <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow>
                <TableHead>Season</TableHead><TableHead>Currency</TableHead><TableHead>Settlements</TableHead><TableHead>Paid</TableHead><TableHead>Draft</TableHead>
                <TableHead>Gross</TableHead><TableHead>Deductions</TableHead><TableHead>Net paid</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {settlements.length === 0 && empty(8)}
                {settlements.map((r) => (
                  <TableRow key={`${r.season_label}-${r.currency}`}>
                    <TableCell>{r.season_label}</TableCell>
                    <TableCell className="font-mono text-xs">{asCurrency(r.currency)}</TableCell>
                    <TableCell className="tabular-nums">{num(r.settlement_count)}</TableCell>
                    <TableCell className="tabular-nums">{num(r.paid_count)}</TableCell>
                    {/* Drafts are money owed to farmers that has not gone out. */}
                    <TableCell className="tabular-nums">{num(r.draft_count)}</TableCell>
                    <TableCell className="tabular-nums">{money(r.gross_value, r.currency)}</TableCell>
                    <TableCell className="tabular-nums">{money(r.total_deductions, r.currency)}</TableCell>
                    <TableCell className="tabular-nums">{money(r.net_payment, r.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="alertSummary">
          <Card><CardContent className="p-0">
            <ExportButton rows={alertSummary} columns={REPORT_COLUMNS.alerts} name="alert-summary" />
            <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow>
                <TableHead>Type</TableHead><TableHead>Severity</TableHead><TableHead>Status</TableHead><TableHead>Count</TableHead><TableHead>Last seen</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {alertSummary.length === 0 && empty(5)}
                {alertSummary.map((r) => (
                  <TableRow key={`${r.alert_type}-${r.severity}-${r.status}`}>
                    <TableCell>{r.alert_type ? alertTypeLabel(r.alert_type) : "—"}</TableCell>
                    <TableCell>{r.severity ? humanize(r.severity) : "—"}</TableCell>
                    <TableCell>{r.status ? alertStatusLabel(r.status) : "—"}</TableCell>
                    <TableCell className="tabular-nums">{num(r.alert_count)}</TableCell>
                    <TableCell>{r.last_detected ? new Date(r.last_detected).toLocaleDateString() : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="alerts">
          <Card><CardContent className="p-0">
            <RowCapNotice show={!!truncated.alerts} noun="alerts" />
            <ExportButton rows={alerts} columns={ALERT_COLUMNS} name="alerts" />
            <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Severity</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
              <TableBody>
                {alerts.length === 0 && empty(4)}
                {alerts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{alertTypeLabel(a.alert_type)}</TableCell>
                    <TableCell>{humanize(a.severity)}</TableCell>
                    <TableCell>{alertStatusLabel(a.status)}</TableCell>
                    <TableCell>{new Date(a.detected_date).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
