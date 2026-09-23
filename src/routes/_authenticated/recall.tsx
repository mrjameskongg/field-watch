// Recall lookup: type any code, get the whole chain both directions at once.
//
// One-up/one-down is the floor auditors accept and the answer they allow you a
// day to produce. This answers in a second, and goes all the way rather than
// one step: from a batch, every farmer, parcel, delivery and contract that fed
// it; from a farmer, every batch their rice reached. The reconciliation checks
// run at the same time, because the moment you can see the whole lot is the
// moment an impossible number is worth catching.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeSearch } from "@/lib/search-core";
import { ok } from "@/lib/supabase-helpers";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AlertTriangle, ArrowDown, ArrowUp, Search, ShieldCheck } from "lucide-react";
import {
  CONVERSION,
  criticalEvents,
  genealogyBack,
  massBalanceCheck,
  yieldPlausibility,
  type CriticalEvent,
  type Genealogy,
  type LotInput,
  type MassBalance,
  type YieldCheck,
} from "@/lib/lot-core";
import { stageTotals } from "@/lib/batch-core";

export const Route = createFileRoute("/_authenticated/recall")({
  component: RecallPage,
});

type BackResult = {
  kind: "lot";
  batchCode: string;
  status: string;
  custody: string;
  events: CriticalEvent[];
  genealogy: Genealogy;
  balance: MassBalance;
  yieldCheck: YieldCheck;
};
type ForwardResult = {
  kind: "farmer";
  farmerName: string;
  farmerCode: string;
  lots: { batch_code: string; status: string; kg: number }[];
  deliveries: number;
  totalKg: number;
};
type Result = BackResult | ForwardResult;

function RecallPage() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);

  const lookup = useCallback(async () => {
    const code = query.trim();
    if (!code) return;
    setBusy(true);
    setSearched(true);
    setResult(null);

    // A batch code searches backwards; a farmer or delivery code searches
    // forwards. Try the lot first — it is the answer a recall actually needs.
    const batchRes = await supabase
      .from("batches")
      .select("id, batch_code, custody_model, status, created_date, storage_location")
      .ilike("batch_code", code)
      .maybeSingle();
    if (batchRes.error) {
      setBusy(false);
      ok(batchRes.error, "Look up batch");
      return;
    }

    if (batchRes.data) {
      const batch = batchRes.data;
      const [delRes, wpRes, qcRes, profRes] = await Promise.all([
        supabase
          .from("deliveries")
          .select(
            "id, delivery_code, received_date, gross_weight_kg, moisture_pct, grade, received_by, contracts(contract_code, farmers(id, full_name, farmer_code, village))",
          )
          .eq("batch_id", batch.id),
        supabase
          .from("batch_weigh_points")
          .select("stage, weight_kg, moisture_pct, recorded_date, recorded_by")
          .eq("batch_id", batch.id),
        supabase.from("qc_tests").select("test_type, result_value, passed, tested_date").eq("batch_id", batch.id),
        supabase.from("profiles").select("user_id, full_name"),
      ]);
      if (!ok(delRes.error, "Load deliveries")) return setBusy(false);
      if (!ok(wpRes.error, "Load weigh points")) return setBusy(false);

      const names: Record<string, string> = {};
      (profRes.data ?? []).forEach((p) => {
        if (p.full_name) names[p.user_id] = p.full_name;
      });

      type DelRow = {
        id: string;
        delivery_code: string;
        received_date: string;
        gross_weight_kg: number;
        moisture_pct: number | null;
        grade: string | null;
        received_by: string | null;
        contracts: {
          contract_code: string;
          farmers: { id: string; full_name: string; farmer_code: string; village: string | null } | null;
        } | null;
      };
      const delRows = (delRes.data as unknown as DelRow[]) ?? [];

      // Parcels belong to the farmers behind those deliveries.
      const farmerIds = [...new Set(delRows.map((d) => d.contracts?.farmers?.id).filter(Boolean) as string[])];
      let farmsByFarmer: Record<string, { farm_code: string; area_hectares: number | null; mapped: boolean }[]> = {};
      if (farmerIds.length > 0) {
        const farmsRes = await supabase
          .from("farms")
          .select("farmer_id, farm_code, area_hectares, boundary_geojson")
          .in("farmer_id", farmerIds);
        if (!ok(farmsRes.error, "Load parcels")) return setBusy(false);
        farmsByFarmer = (farmsRes.data ?? []).reduce<typeof farmsByFarmer>((acc, f) => {
          (acc[f.farmer_id] ||= []).push({
            farm_code: f.farm_code,
            area_hectares: f.area_hectares,
            mapped: f.boundary_geojson !== null,
          });
          return acc;
        }, {});
      }

      const lotInput: LotInput = {
        batch,
        deliveries: delRows.map((d) => ({
          id: d.id,
          delivery_code: d.delivery_code,
          received_date: d.received_date,
          gross_weight_kg: d.gross_weight_kg,
          moisture_pct: d.moisture_pct,
          grade: d.grade,
          received_by_name: d.received_by ? (names[d.received_by] ?? "Staff") : null,
          farmer: d.contracts?.farmers ?? null,
          parcels: d.contracts?.farmers ? (farmsByFarmer[d.contracts.farmers.id] ?? []) : [],
          contract_code: d.contracts?.contract_code ?? null,
        })),
        weighPoints: (wpRes.data ?? []).map((w) => ({
          stage: w.stage,
          weight_kg: w.weight_kg,
          moisture_pct: w.moisture_pct,
          recorded_date: w.recorded_date,
          recorded_by_name: w.recorded_by ? (names[w.recorded_by] ?? "Staff") : null,
        })),
        qcTests: (qcRes.data ?? []).map((q) => ({
          test_type: q.test_type,
          result_value: q.result_value,
          passed: q.passed,
          tested_date: q.tested_date,
          scope: "batch" as const,
        })),
      };

      const totals = stageTotals(lotInput.weighPoints);
      const genealogy = genealogyBack(lotInput);
      const hectares = [
        ...new Map(
          lotInput.deliveries.flatMap((d) => d.parcels).map((p) => [p.farm_code, p]),
        ).values(),
      ].reduce((s, p) => s + (p.area_hectares ?? 0), 0);
      const deliveredKg = lotInput.deliveries.reduce((s, d) => s + d.gross_weight_kg, 0);

      setResult({
        kind: "lot",
        batchCode: batch.batch_code,
        status: batch.status,
        custody: batch.custody_model,
        events: criticalEvents(lotInput),
        genealogy,
        balance: massBalanceCheck(totals.into_mill ?? 0, totals.milled_output ?? 0),
        yieldCheck: yieldPlausibility(deliveredKg, hectares || null),
      });
      setBusy(false);
      return;
    }

    // Not a batch — try a farmer code or name, and search forward.
    const farmerRes = await supabase
      .from("farmers")
      .select("id, full_name, farmer_code")
      .or(`farmer_code.ilike.${sanitizeSearch(code)},full_name.ilike.%${sanitizeSearch(code)}%`)
      .limit(1)
      .maybeSingle();
    if (farmerRes.error) {
      setBusy(false);
      ok(farmerRes.error, "Look up farmer");
      return;
    }
    if (!farmerRes.data) {
      setBusy(false);
      return;
    }

    const farmer = farmerRes.data;
    const delRes = await supabase
      .from("deliveries")
      .select("gross_weight_kg, batches(batch_code, status), contracts!inner(farmer_id)")
      .eq("contracts.farmer_id", farmer.id);
    if (!ok(delRes.error, "Load deliveries")) return setBusy(false);
    type FwdRow = { gross_weight_kg: number; batches: { batch_code: string; status: string } | null };
    const rows = (delRes.data as unknown as FwdRow[]) ?? [];

    const byLot = new Map<string, { batch_code: string; status: string; kg: number }>();
    for (const r of rows) {
      if (!r.batches) continue;
      const prev = byLot.get(r.batches.batch_code);
      byLot.set(r.batches.batch_code, {
        batch_code: r.batches.batch_code,
        status: r.batches.status,
        kg: (prev?.kg ?? 0) + r.gross_weight_kg,
      });
    }

    setResult({
      kind: "farmer",
      farmerName: farmer.full_name,
      farmerCode: farmer.farmer_code,
      lots: [...byLot.values()],
      deliveries: rows.length,
      totalKg: rows.reduce((s, r) => s + r.gross_weight_kg, 0),
    });
    setBusy(false);
  }, [query]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Recall lookup</h1>
        <p className="text-sm text-muted-foreground">
          A batch code shows everything that went into it. A farmer name or code shows every batch their rice reached.
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Batch code, farmer code, or farmer name..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") lookup();
                }}
                className="pl-9"
              />
            </div>
            <Button onClick={lookup} disabled={busy || !query.trim()}>
              {busy ? "Looking..." : "Trace"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {searched && !busy && !result && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Nothing matches "{query}". Try a batch code, a farmer code, or part of a farmer's name.
          </CardContent>
        </Card>
      )}

      {result?.kind === "lot" && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-semibold">{result.batchCode}</h2>
            <Badge variant="outline" className="capitalize">
              {result.status}
            </Badge>
            <Badge variant="outline">
              {result.custody === "mass_balance" ? "Mixed lot" : "Single farm"}
            </Badge>
          </div>

          {(result.balance.exceeded || result.yieldCheck.implausible) && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive space-y-1">
              {result.balance.exceeded && (
                <p className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  This lot claims {result.balance.recoveryPct}% of its paddy as head rice. Milling cannot exceed{" "}
                  {Math.round(CONVERSION.maxMilledFraction * 100)}%, so the output is more than the recorded input
                  could produce
                  {result.balance.ceilingKg !== null &&
                    ` — at most ${Math.round(result.balance.ceilingKg).toLocaleString()} kg`}
                  . Check the weighings, or whether rice from another lot was mixed in.
                </p>
              )}
              {result.yieldCheck.implausible && (
                <p className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  {result.yieldCheck.reason}
                </p>
              )}
            </div>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ArrowUp className="h-4 w-4" />
                Everything that fed this lot
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Field label="Farmers">
                {result.genealogy.farmers.length === 0 ? (
                  <span className="text-muted-foreground">None attached</span>
                ) : (
                  result.genealogy.farmers.map((f) => (
                    <Badge key={f.code} variant="secondary" className="font-normal mr-1">
                      {f.name} ({f.code}) — {f.kg.toLocaleString()} kg
                    </Badge>
                  ))
                )}
              </Field>
              <Field label="Parcels">
                {result.genealogy.parcels.length === 0 ? (
                  <span className="text-muted-foreground">None mapped</span>
                ) : (
                  result.genealogy.parcels.map((p) => (
                    <Badge key={p} variant="secondary" className="font-normal mr-1">
                      {p}
                    </Badge>
                  ))
                )}
              </Field>
              <Field label="Deliveries">{result.genealogy.deliveries.join(", ") || "—"}</Field>
              <Field label="Contracts">{result.genealogy.contracts.join(", ") || "—"}</Field>
              {result.balance.recoveryPct !== null && (
                <Field label="Mass balance">
                  {result.balance.recoveryPct}% of paddy into the mill came out as head rice
                  {!result.balance.exceeded && " — within what the input can yield"}
                </Field>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Event ledger</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="text-left p-2 font-medium">Lot</th>
                      <th className="text-left p-2 font-medium">Event</th>
                      <th className="text-left p-2 font-medium">What</th>
                      <th className="text-left p-2 font-medium">When</th>
                      <th className="text-left p-2 font-medium">Where</th>
                      <th className="text-left p-2 font-medium">Who</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.events.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-4 text-center text-muted-foreground">
                          No events recorded on this lot yet.
                        </td>
                      </tr>
                    )}
                    {result.events.map((e, i) => (
                      <tr key={i} className="border-b last:border-b-0">
                        <td className="p-2 font-mono text-xs">{e.lot_code}</td>
                        <td className="p-2">{e.label}</td>
                        <td className="p-2 tabular-nums">{e.what}</td>
                        <td className="p-2 tabular-nums">{e.when}</td>
                        <td className="p-2">{e.where}</td>
                        <td className="p-2">{e.who}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {result?.kind === "farmer" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowDown className="h-4 w-4" />
              Every lot {result.farmerName}'s rice reached
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Field label="Farmer">
              {result.farmerName} ({result.farmerCode})
            </Field>
            <Field label="Delivered">
              {result.deliveries} load{result.deliveries === 1 ? "" : "s"} · {result.totalKg.toLocaleString()} kg
            </Field>
            <Field label="Lots">
              {result.lots.length === 0 ? (
                <span className="text-muted-foreground">None of this farmer's rice is in a batch yet</span>
              ) : (
                result.lots.map((l) => (
                  <Badge key={l.batch_code} variant="secondary" className="font-normal mr-1">
                    {l.batch_code} ({l.status}) — {l.kg.toLocaleString()} kg
                  </Badge>
                ))
              )}
            </Field>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Why this page exists
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Buyers and food-safety rules ask you to trace one step back and one step forward, and allow you a day to
            answer. This answers in a second and goes the whole way instead of one step — and while it resolves the
            chain it also checks two things an auditor looks for: that milled output could actually come from the paddy
            recorded, and that delivered volume fits the land it is claimed from.
          </p>
          <p>
            Every event carries the same lot code, so a batch, its weighings, its quality tests and its farmers are one
            record rather than four. Batches are created on the{" "}
            <Link to="/batches" className="underline">
              Batches
            </Link>{" "}
            page.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-3">
      <span className="text-xs text-muted-foreground sm:w-28 shrink-0 pt-0.5">{label}</span>
      <span className="flex-1 flex flex-wrap gap-1 items-center">{children}</span>
    </div>
  );
}
