// The Farmer File: one page per farmer holding James's five procurement
// documents as sections — Biodata, Purchase, Lending, Receipts, Testing.
// Each section shows its records or points at the screen that creates them.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Plus } from "lucide-react";
import { ok } from "@/lib/supabase-helpers";
import { farmerDocs, DOC_ORDER, type DocStatus } from "@/lib/farmer-file-core";
import { DOC_TITLE_KEY, docStateClass } from "@/components/farmer-file";
import { useI18n } from "@/lib/i18n";
import type { Database } from "@/integrations/supabase/types";
import { asCurrency, fmtMoney } from "@/lib/money-core";

type Farmer = Database["public"]["Tables"]["farmers"]["Row"];
type Farm = Database["public"]["Tables"]["farms"]["Row"];
type FieldVisit = Database["public"]["Tables"]["field_visits"]["Row"];
type Alert = Database["public"]["Tables"]["alerts"]["Row"];
type Contract = Database["public"]["Tables"]["contracts"]["Row"];
type Advance = Database["public"]["Tables"]["input_advances"]["Row"];
type Delivery = Database["public"]["Tables"]["deliveries"]["Row"];
type QcTest = Database["public"]["Tables"]["qc_tests"]["Row"];

export const Route = createFileRoute("/_authenticated/farmers_/$farmerId")({
  component: FarmerFilePage,
});


function FarmerFilePage() {
  const { farmerId } = Route.useParams();
  const { t } = useI18n();
  const [farmer, setFarmer] = useState<Farmer | null>(null);
  const [farms, setFarms] = useState<Farm[]>([]);
  const [visits, setVisits] = useState<FieldVisit[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [moistureTests, setMoistureTests] = useState<QcTest[]>([]);
  const [docsReady, setDocsReady] = useState(false);

  useEffect(() => {
    async function load() {
      const [farmerRes, farmsRes, visitsRes, alertsRes, contractsRes] = await Promise.all([
        supabase.from("farmers").select("*").eq("id", farmerId).single(),
        supabase.from("farms").select("*").eq("farmer_id", farmerId).limit(1000),
        supabase.from("field_visits").select("*").eq("farmer_id", farmerId).order("visit_date", { ascending: false }).limit(50),
        supabase.from("alerts").select("*").eq("farmer_id", farmerId).order("created_at", { ascending: false }).limit(1000),
        supabase.from("contracts").select("*").eq("farmer_id", farmerId).order("created_at", { ascending: false }).limit(1000),
      ]);
      ok(farmerRes.error, "Load farmer");
      setFarmer(farmerRes.data);
      setFarms(farmsRes.data ?? []);
      setVisits(visitsRes.data ?? []);
      setAlerts(alertsRes.data ?? []);
      setContracts(contractsRes.data ?? []);

      const contractIds = (contractsRes.data ?? []).map((c) => c.id);
      let advRes = { data: [] as Advance[], error: null as unknown };
      let delRes = { data: [] as Delivery[], error: null as unknown };
      let qcRes = { data: [] as QcTest[], error: null as unknown };
      if (contractIds.length) {
        [advRes, delRes] = (await Promise.all([
          supabase.from("input_advances").select("*").in("contract_id", contractIds).order("date_issued", { ascending: false }).limit(1000),
          supabase.from("deliveries").select("*").in("contract_id", contractIds).order("received_date", { ascending: false }).limit(1000),
        ])) as [typeof advRes, typeof delRes];
        const deliveryIds = (delRes.data ?? []).map((d) => d.id);
        if (deliveryIds.length) {
          qcRes = (await supabase
            .from("qc_tests")
            .select("*")
            .eq("test_type", "moisture")
            .in("delivery_id", deliveryIds)
            .order("tested_date", { ascending: false })
            .limit(1000)) as typeof qcRes;
        }
      }
      setAdvances(advRes.data ?? []);
      setDeliveries(delRes.data ?? []);
      setMoistureTests(qcRes.data ?? []);
      // Statuses only render when every query behind them succeeded.
      setDocsReady(
        ![farmerRes, farmsRes, visitsRes, alertsRes, contractsRes, advRes, delRes, qcRes].some((r) => r.error),
      );
    }
    load();
  }, [farmerId]);

  if (!farmer) return <div className="text-muted-foreground">Loading...</div>;

  const burnAlerts = alerts.filter(
    (a) => a.alert_type === "possible_burn" && (a.status === "new" || a.status === "investigating"),
  );
  const docs: DocStatus[] = farmerDocs({
    phone: farmer.phone_number,
    mappedFarms: farms.filter((f) => f.latitude !== null || f.boundary_geojson !== null).length,
    totalFarms: farms.length,
    contracts,
    advanceCount: advances.length,
    deliveries,
    moistureTestedDeliveryIds: new Set(moistureTests.map((q) => q.delivery_id).filter(Boolean) as string[]),
    activeBurnAlerts: burnAlerts.length,
  });
  const docState = (key: DocStatus["key"]) => docs.find((d) => d.key === key)!;

  const liveContracts = contracts.filter((c) => c.status !== "cancelled");
  const expectedKg = liveContracts.reduce((s, c) => s + (c.expected_yield_kg ?? 0), 0);
  const deliveredKg = deliveries.reduce((s, d) => s + d.gross_weight_kg, 0);
  const contractCode = new Map(contracts.map((c) => [c.id, c.contract_code]));
  const contractCurrency = new Map(contracts.map((c) => [c.id, asCurrency(c.currency)]));
  const newestLive = liveContracts[0];
  const deliveryCode = new Map(deliveries.map((d) => [d.id, d.delivery_code]));

  const SectionHeader = ({ doc }: { doc: DocStatus }) => {
    const idx = DOC_ORDER.indexOf(doc.key);
    return (
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <span
            className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${docStateClass[doc.state]}`}
          >
            {doc.state === "na" ? "–" : idx + 1}
          </span>
          {t(DOC_TITLE_KEY[doc.key])}
          {docsReady && doc.state === "current" && (
            <Badge className="bg-chart-4 text-white">{t("ff.next")}</Badge>
          )}
          {docsReady && doc.state === "attention" && <Badge variant="destructive">!</Badge>}
          <span className="ml-auto text-xs font-normal text-muted-foreground">{docsReady ? doc.detail : ""}</span>
        </CardTitle>
      </CardHeader>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/farmers"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <div>
          <h1 className="text-2xl font-bold">{farmer.full_name}</h1>
          <p className="text-sm text-muted-foreground">{farmer.farmer_code} · {t("ff.file")}</p>
        </div>
        <Badge className="ml-auto capitalize">{farmer.status}</Badge>
      </div>

      {/* 1 · Biodata */}
      <Card>
        <SectionHeader doc={docState("bio")} />
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-3 gap-3">
            {[
              ["Gender", farmer.gender],
              ["Phone", farmer.phone_number],
              ["Secondary Phone", farmer.secondary_phone],
              ["National ID", farmer.national_id_or_reference],
              ["Province", farmer.province],
              ["District", farmer.district],
              ["Commune", farmer.commune],
              ["Village", farmer.village],
              ["Crop Type", farmer.crop_type],
              ["Registration Date", farmer.registration_date],
              ["Certifications", farmer.certifications],
              ["Labor Notes", farmer.labor_notes],
              ["Notes", farmer.notes],
            ].map(([label, val]) => (
              <div key={label as string}>
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="text-sm font-medium capitalize">{(val as string) || "—"}</div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Farms ({farms.length})</div>
            <Link to="/farms">
              <Button size="sm" variant="outline"><Plus className="h-3.5 w-3.5 mr-1" />{t("ff.addFarm")}</Button>
            </Link>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Area (ha)</TableHead>
                  <TableHead>Map</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {farms.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell><Link to="/farms/$farmId" params={{ farmId: f.id }} className="text-primary hover:underline">{f.farm_code}</Link></TableCell>
                    <TableCell>{f.farm_name}</TableCell>
                    <TableCell>{f.area_hectares ?? "—"}</TableCell>
                    <TableCell>
                      {f.latitude !== null || f.boundary_geojson !== null
                        ? <Badge variant="secondary" className="bg-chart-2/10 text-chart-2">{t("ff.mapped")}</Badge>
                        : <Badge variant="secondary" className="bg-destructive/10 text-destructive">{t("ff.notMapped")}</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
                {farms.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No farms</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>

          {visits.length > 0 && (
            <div>
              <div className="text-sm font-medium mb-1">{t("ff.visits")} ({visits.length})</div>
              <div className="text-sm text-muted-foreground space-y-0.5">
                {visits.slice(0, 5).map((v) => (
                  <div key={v.id}>{v.visit_date} · <span className="capitalize">{v.visit_type}</span>{v.crop_condition ? ` · ${v.crop_condition}` : ""}</div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2 · Purchase documents */}
      <Card>
        <SectionHeader doc={docState("purchase")} />
        <CardContent className="space-y-3">
          <div className="flex justify-end">
            <Link to="/contracts" search={{ new: 1, farmer: farmerId }}>
              <Button size="sm"><Plus className="h-3.5 w-3.5 mr-1" />{t("ff.newContract")}</Button>
            </Link>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Season</TableHead>
                  <TableHead>Expected (kg)</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell><Link to="/contracts/$contractId" params={{ contractId: c.id }} className="text-primary hover:underline font-medium">{c.contract_code}</Link></TableCell>
                    <TableCell>{c.season_label}</TableCell>
                    <TableCell>{c.expected_yield_kg?.toLocaleString() ?? "—"}</TableCell>
                    <TableCell>{c.price_mode === "fixed" && c.fixed_price_per_kg !== null ? `${fmtMoney(c.fixed_price_per_kg, asCurrency(c.currency))}/kg` : "market"}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{c.status}</Badge></TableCell>
                  </TableRow>
                ))}
                {contracts.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No contracts yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* 3 · Lending documents */}
      <Card>
        <SectionHeader doc={docState("lending")} />
        <CardContent className="space-y-3">
          {newestLive && (
            <div className="flex justify-end">
              <Link to="/contracts/$contractId" params={{ contractId: newestLive.id }}>
                <Button size="sm" variant="outline"><Plus className="h-3.5 w-3.5 mr-1" />{t("ff.recordAdvance")}</Button>
              </Link>
            </div>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Contract</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {advances.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.date_issued}</TableCell>
                    <TableCell className="capitalize">{a.item_type}{a.description ? ` · ${a.description}` : ""}</TableCell>
                    <TableCell>{a.quantity !== null ? `${a.quantity} ${a.unit ?? ""}` : "—"}</TableCell>
                    <TableCell className="tabular-nums">{fmtMoney(a.total_cost, contractCurrency.get(a.contract_id))}</TableCell>
                    <TableCell>{contractCode.get(a.contract_id) ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {advances.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No advances recorded</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* 4 · Receive documents */}
      <Card>
        <SectionHeader doc={docState("receipts")} />
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            {expectedKg > 0 && (
              <div className="flex-1">
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>{Math.round(deliveredKg).toLocaleString()} / {Math.round(expectedKg).toLocaleString()} kg</span>
                  <span>{Math.round((deliveredKg / expectedKg) * 100)}%</span>
                </div>
                <Progress value={Math.min(100, (deliveredKg / expectedKg) * 100)} />
              </div>
            )}
            <Link to="/deliveries" search={{ new: 1 }}>
              <Button size="sm"><Plus className="h-3.5 w-3.5 mr-1" />{t("ff.recordDelivery")}</Button>
            </Link>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Weight (kg)</TableHead>
                  <TableHead>Moisture</TableHead>
                  <TableHead>Paid</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.delivery_code}</TableCell>
                    <TableCell>{d.received_date}</TableCell>
                    <TableCell>{d.gross_weight_kg.toLocaleString()}</TableCell>
                    <TableCell>
                      {d.moisture_pct !== null ? `${d.moisture_pct}%` : "—"}
                      {d.moisture_flagged && <Badge variant="destructive" className="ml-1">wet</Badge>}
                    </TableCell>
                    <TableCell>
                      {d.settlement_id
                        ? <Badge variant="secondary" className="bg-chart-2/10 text-chart-2">paid</Badge>
                        : <Badge variant="outline">open</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
                {deliveries.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No deliveries yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* 5 · Testing */}
      <Card>
        <SectionHeader doc={docState("testing")} />
        <CardContent className="space-y-3">
          <div className="flex justify-end">
            <Link to="/qc">
              <Button size="sm" variant="outline"><Plus className="h-3.5 w-3.5 mr-1" />{t("ff.recordTest")}</Button>
            </Link>
          </div>
          {burnAlerts.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              {burnAlerts.map((a) => (
                <div key={a.id} className="flex items-center gap-2">
                  <Badge variant="destructive">burn</Badge>
                  <span>{new Date(a.detected_date).toLocaleDateString()} · {a.description ?? "Possible burn detected"}</span>
                </div>
              ))}
            </div>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Delivery</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Moisture</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {moistureTests.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell>{q.delivery_id ? deliveryCode.get(q.delivery_id) ?? "—" : "—"}</TableCell>
                    <TableCell>{q.tested_date}</TableCell>
                    <TableCell>{q.result_value !== null ? `${q.result_value}%` : q.result_text ?? "—"}</TableCell>
                    <TableCell>
                      {q.passed === null
                        ? <Badge variant="outline">pending</Badge>
                        : q.passed
                          ? <Badge variant="secondary" className="bg-chart-2/10 text-chart-2">pass</Badge>
                          : <Badge variant="destructive">fail</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
                {moistureTests.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No moisture tests yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
