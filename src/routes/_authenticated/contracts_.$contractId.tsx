// Contract detail: advances, deliveries, settlement wizard, print slip.
// Mirrors farmers_.$farmerId (detail-page shape) + season.tsx (dialog style,
// progress-bar visual). Single file — the settle handler is intentionally
// inline in the page component (not a child) so it can close over
// deliveries/advances/contract/reload/setSettleOpen directly.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ok } from "@/lib/supabase-helpers";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, FlaskConical, Plus, Printer, Trash2 } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { ChainFlow } from "@/components/chain";
import { chainSteps } from "@/lib/chain-core";
import { batchMath, isEstimated } from "@/lib/batch-core";
import { asCurrency, fmtMoney, type Currency } from "@/lib/money-core";
import {
  deliveryValue,
  genCode,
  performanceRatio,
  round2,
  settlementMath,
  untestedDeliveryIds,
} from "@/lib/trade-core";
import { contractDisplayStatus } from "@/lib/contract-core";
import { advanceItemLabel, PAYMENT_METHODS, settlementStatusLabel } from "@/lib/labels";
import { QcDialog } from "@/components/qc";

type Contract = Database["public"]["Tables"]["contracts"]["Row"];
type Advance = Database["public"]["Tables"]["input_advances"]["Row"];
type AdvanceInsert = Database["public"]["Tables"]["input_advances"]["Insert"];
type Delivery = Database["public"]["Tables"]["deliveries"]["Row"];
type DeliveryWithBatch = Delivery & { batches: { id: string; batch_code: string; status: string } | null };
/** A batch this contract's rice went into, with its measured drying loss. */
type ChainBatch = { id: string; batch_code: string; status: string; dryingLossPct: number | null; dryingLossEstimated: boolean };
type Settlement = Database["public"]["Tables"]["settlements"]["Row"];
type FarmerLite = {
  id: string;
  full_name: string;
  farmer_code: string;
  village: string | null;
  commune: string | null;
  district: string | null;
  province: string | null;
  national_id_or_reference: string | null;
  registration_date: string | null;
};
type ContractWithFarmer = Contract & { farmers: FarmerLite | null };

export const Route = createFileRoute("/_authenticated/contracts_/$contractId")({
  component: ContractDetailPage,
});

const today = () => new Date().toISOString().slice(0, 10);

const contractStatusColors: Record<string, string> = {
  active: "bg-chart-2/10 text-chart-2",
  season_closed: "border-amber-500/50 text-amber-600",
  completed: "bg-muted text-muted-foreground",
  cancelled: "bg-destructive/10 text-destructive",
};

function ContractDetailPage() {
  // Bound below once the contract row is loaded; until then USD is harmless (nothing renders).
  const { contractId } = Route.useParams();
  const { hasRole } = useAuth();
  const canManage = hasRole("admin") || hasRole("manager");
  const { confirm, confirmDialog } = useConfirm();

  const [contract, setContract] = useState<ContractWithFarmer | null>(null);
  const cur: Currency = asCurrency(contract?.currency);
  const money = (n: number | null | undefined) => fmtMoney(n, cur);
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryWithBatch[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [qcTests, setQcTests] = useState<{ delivery_id: string; test_type: string; tested_date: string }[]>([]);
  const [chainBatches, setChainBatches] = useState<ChainBatch[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [paidTarget, setPaidTarget] = useState<Settlement | null>(null);
  // Moisture test recorded from inside the payment dialog, so the clerk
  // never has to leave the page to satisfy the payment gate.
  const [qcDeliveryId, setQcDeliveryId] = useState<string | null>(null);

  // Mutually exclusive print targets — exactly one hidden div renders at a
  // time (the settlement slip, or the contract agreement), so `window.print()`
  // can never pick up both.
  const [printTarget, setPrintTarget] = useState<"slip" | "contract" | null>(null);
  const [printSettlement, setPrintSettlement] = useState<Settlement | null>(null);

  const printSlip = (s: Settlement) => {
    setPrintSettlement(s);
    setPrintTarget("slip");
  };
  const printContract = () => setPrintTarget("contract");

  const reload = useCallback(async () => {
    const [c, a, d, s] = await Promise.all([
      supabase
        .from("contracts")
        .select("*, farmers(id, full_name, farmer_code, village, commune, district, province, national_id_or_reference, registration_date)")
        .eq("id", contractId)
        .single(),
      supabase.from("input_advances").select("*").eq("contract_id", contractId).order("date_issued", { ascending: false }),
      supabase.from("deliveries").select("*, batches(id, batch_code, status)").eq("contract_id", contractId).order("received_date", { ascending: false }),
      supabase.from("settlements").select("*").eq("contract_id", contractId).order("settled_date", { ascending: false }),
    ]);
    setLoaded(true);
    if (!ok(c.error, "Load contract")) return;
    setContract((c.data as unknown as ContractWithFarmer) ?? null);
    if (!ok(a.error, "Load advances")) return;
    setAdvances(a.data ?? []);
    if (!ok(d.error, "Load deliveries")) return;
    const deliveryRows = (d.data as unknown as DeliveryWithBatch[]) ?? [];
    setDeliveries(deliveryRows);
    if (!ok(s.error, "Load settlements")) return;
    setSettlements(s.data ?? []);
    // QC tests gate the settle wizard (moisture test required before payment),
    // so load them for this contract's deliveries after the ids are known.
    const deliveryIds = deliveryRows.map((row) => row.id);
    if (deliveryIds.length === 0) {
      setQcTests([]);
      setChainBatches([]);
      return;
    }
    const q = await supabase
      .from("qc_tests")
      .select("delivery_id, test_type, tested_date")
      .in("delivery_id", deliveryIds);
    if (!ok(q.error, "Load QC tests")) return;
    // delivery_id is nullable schema-wide (batch-scoped tests), but the .in()
    // filter guarantees non-null here.
    setQcTests(
      (q.data ?? []).filter(
        (t): t is { delivery_id: string; test_type: string; tested_date: string } => t.delivery_id !== null,
      ),
    );

    // Batches these deliveries joined, with drying loss measured from their
    // weigh points — the last two steps of the chain flow.
    const batchRows = deliveryRows.map((row) => row.batches).filter((b): b is NonNullable<typeof b> => b !== null);
    const uniqueBatches = [...new Map(batchRows.map((b) => [b.id, b])).values()];
    if (uniqueBatches.length === 0) {
      setChainBatches([]);
      return;
    }
    const wp = await supabase
      .from("batch_weigh_points")
      .select("batch_id, stage, weight_kg, moisture_pct, estimated")
      .in("batch_id", uniqueBatches.map((b) => b.id));
    if (!ok(wp.error, "Load weigh points")) return;
    setChainBatches(
      uniqueBatches.map((b) => {
        const m = batchMath((wp.data ?? []).filter((p) => p.batch_id === b.id));
        return { ...b, dryingLossPct: m.dryingLossPct, dryingLossEstimated: isEstimated(m, "received", "post_drying") };
      }),
    );
  }, [contractId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Print once printTarget is set — the effect runs after the hidden div has
  // committed to the DOM (React state updates aren't synchronous the way
  // window.print() is), so the browser's print dialog always sees rendered
  // content. Reset on afterprint so a future click starts clean even if the
  // user cancels the dialog.
  useEffect(() => {
    if (printTarget) window.print();
  }, [printTarget]);
  useEffect(() => {
    const clear = () => {
      setPrintTarget(null);
      setPrintSettlement(null);
    };
    window.addEventListener("afterprint", clear);
    return () => window.removeEventListener("afterprint", clear);
  }, []);

  const deliveredKg = useMemo(() => deliveries.reduce((sum, d) => sum + d.gross_weight_kg, 0), [deliveries]);
  const ratio = contract ? performanceRatio(deliveredKg, contract.expected_yield_kg) : null;

  const steps = useMemo(
    () =>
      chainSteps({
        currency: cur,
        farmerRegisteredDate: contract?.farmers?.registration_date ?? null,
        farmerName: contract?.farmers?.full_name ?? null,
        contractSignedDate: contract?.signed_date ?? null,
        contractStatus: contract?.status ?? null,
        contractCode: contract?.contract_code ?? null,
        expectedKg: contract?.expected_yield_kg ?? null,
        advances: advances.map((a) => ({ date_issued: a.date_issued, total_cost: a.total_cost })),
        deliveries: deliveries.map((d) => ({
          id: d.id,
          code: d.delivery_code,
          received_date: d.received_date,
          gross_weight_kg: d.gross_weight_kg,
          moisture_pct: d.moisture_pct,
          settlement_id: d.settlement_id,
          batch_id: d.batch_id,
        })),
        qcTests,
        settlements: settlements.map((x) => ({
          settled_date: x.settled_date,
          net_payment: x.net_payment,
          status: x.status,
        })),
        batches: chainBatches,
      }),
    [contract, advances, deliveries, qcTests, settlements, chainBatches],
  );

  const unsettledDeliveries = useMemo(() => deliveries.filter((d) => d.settlement_id === null), [deliveries]);
  const unsettledAdvances = useMemo(
    () => advances.filter((a) => a.settlement_id === null && a.deduct_at_settlement),
    [advances],
  );

  // Settle wizard selection — initialised full whenever the dialog opens.
  const [selectedDel, setSelectedDel] = useState<Set<string>>(new Set());
  const [selectedAdv, setSelectedAdv] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (settleOpen) {
      setSelectedDel(new Set(unsettledDeliveries.map((d) => d.id)));
      setSelectedAdv(new Set(unsettledAdvances.map((a) => a.id)));
    }
    // Reset only on open; a mid-dialog reload shouldn't blow away the user's picks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settleOpen]);

  const toggleDel = (id: string) =>
    setSelectedDel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAdv = (id: string) =>
    setSelectedAdv((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const settleTotals = useMemo(
    () =>
      settlementMath(
        deliveries.filter((d) => selectedDel.has(d.id)),
        advances.filter((a) => selectedAdv.has(a.id)),
      ),
    [deliveries, advances, selectedDel, selectedAdv],
  );

  // Moisture-test gate: the farmer is paid at the farm gate only after a
  // moisture reading, so any selected delivery without a recorded moisture
  // test blocks the settlement.
  const untestedDel = useMemo(
    () => new Set(untestedDeliveryIds(unsettledDeliveries.map((d) => d.id), qcTests)),
    [unsettledDeliveries, qcTests],
  );
  const untestedSelectedCount = useMemo(
    () => [...selectedDel].filter((id) => untestedDel.has(id)).length,
    [selectedDel, untestedDel],
  );

  const [settling, setSettling] = useState(false);

  const handleSettle = async () => {
    const dels = deliveries.filter((d) => selectedDel.has(d.id));
    const advs = advances.filter((a) => selectedAdv.has(a.id));
    if (dels.length === 0) {
      toast.error("Select at least one delivery.");
      return;
    }
    if (untestedDeliveryIds(dels.map((d) => d.id), qcTests).length > 0) {
      toast.error("Moisture test required before payment — record it from the flask button beside the load.");
      return;
    }
    setSettling(true);
    const m = settlementMath(dels, advs);
    const code = genCode("ST");
    const { data: st, error } = await supabase
      .from("settlements")
      .insert({
        settlement_code: code,
        contract_id: contract!.id,
        gross_value: m.gross,
        total_deductions: m.deductions,
        net_payment: m.net,
      })
      .select()
      .single();
    if (!ok(error, "Create settlement") || !st) {
      setSettling(false);
      return;
    }
    // .is("settlement_id", null) guards against a row that got settled by
    // another session between load and this click — it can then never be
    // re-attached to a second settlement. PostgREST returns success with 0
    // rows affected when the filter excludes a row, so .select("id") is
    // required to actually detect that and warn instead of silently trusting
    // the (now-wrong) stored settlement totals.
    const updates = [
      ...dels.map((d) =>
        supabase.from("deliveries").update({ settlement_id: st.id }).eq("id", d.id).is("settlement_id", null).select("id"),
      ),
      ...advs.map((a) =>
        supabase.from("input_advances").update({ settlement_id: st.id }).eq("id", a.id).is("settlement_id", null).select("id"),
      ),
    ];
    const results = await Promise.all(updates);
    const bad = results.find((r) => r.error);
    if (bad && !ok(bad.error, "Attach records to settlement")) {
      setSettling(false);
      reload();
      return;
    }
    const attachedCount = results.reduce((sum, r) => sum + (r.data?.length ?? 0), 0);
    const expectedCount = dels.length + advs.length;
    if (attachedCount !== expectedCount) {
      toast.error("Some rows were already settled — review settlement");
    } else {
      toast.success(`Settlement ${code}: net ${money(m.net)}`);
    }
    // Fire-and-forget Telegram alert — the function may not be deployed yet
    // (see docs/DEPLOYMENT.md), so a failure here must never
    // surface to the person settling a contract.
    void supabase.functions
      .invoke("settlement-alert", {
        body: {
          event: "created",
          settlement_code: code,
          farmer_name: contract!.farmers?.full_name ?? "Unknown farmer",
          contract_code: contract!.contract_code,
          net_payment: m.net,
        },
      })
      .catch(() => {});
    setSettling(false);
    setSettleOpen(false);
    reload();
  };

  const deleteAdvance = async (adv: Advance) => {
    if (adv.settlement_id) {
      toast.error("This advance is already attached to a settlement.");
      return;
    }
    const confirmed = await confirm({
      title: "Delete this advance?",
      description: adv.description || adv.item_type,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    const { error } = await supabase.from("input_advances").delete().eq("id", adv.id);
    if (!ok(error, "Delete advance")) return;
    toast.success("Advance deleted");
    reload();
  };

  const deleteSettlement = async (settlement: Settlement) => {
    // deliveries.settlement_id / input_advances.settlement_id are
    // ON DELETE SET NULL, so deleting the settlement row cleanly reopens its
    // attached deliveries and advances for a future settlement — the DB
    // handles the reversal, no manual unattach needed here.
    const confirmed = await confirm({
      title: `Delete ${settlement.settlement_code}?`,
      description:
        settlement.status === "paid"
          ? "This settlement is marked PAID. Deleting it will unsettle its attached deliveries and advances, making them available to settle again. This does not reverse the payment itself. Cannot be undone."
          : "This will unsettle its attached deliveries and advances, making them available to settle again. Cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    const { error } = await supabase.from("settlements").delete().eq("id", settlement.id);
    if (!ok(error, "Delete settlement")) return;
    toast.success(`${settlement.settlement_code} deleted`);
    reload();
  };

  const markPaid = async (settlement: Settlement, method: string, reference: string) => {
    const { error } = await supabase
      .from("settlements")
      .update({
        status: "paid",
        payment_method: method.trim() || null,
        payment_reference: reference.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", settlement.id);
    if (!ok(error, "Mark settlement paid")) return;
    toast.success(`${settlement.settlement_code} marked as paid`);
    // Fire-and-forget Telegram alert — same silent-skip contract as the
    // create-settlement call above.
    void supabase.functions
      .invoke("settlement-alert", {
        body: {
          event: "paid",
          settlement_code: settlement.settlement_code,
          farmer_name: contract?.farmers?.full_name ?? "Unknown farmer",
          contract_code: contract?.contract_code ?? "",
          net_payment: settlement.net_payment,
        },
      })
      .catch(() => {});
    setPaidTarget(null);
    reload();
  };

  if (!loaded) return <div className="text-muted-foreground">Loading...</div>;
  if (!contract) return <div className="text-muted-foreground">Contract not found.</div>;

  return (
    <div className="space-y-6">
      <div className="print:hidden space-y-6">
        <div className="flex items-center gap-3">
          <Link to="/contracts" search={{ new: undefined, farmer: undefined }}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{contract.contract_code}</h1>
            <p className="text-sm text-muted-foreground">
              {contract.farmers ? (
                <Link
                  to="/farmers/$farmerId"
                  params={{ farmerId: contract.farmers.id }}
                  className="text-primary hover:underline"
                >
                  {contract.farmers.full_name} ({contract.farmers.farmer_code})
                </Link>
              ) : (
                "—"
              )}
              {" · "}
              {contract.season_label}
            </p>
          </div>
          <Badge variant="outline" className="ml-2">
            {contract.price_mode === "fixed" ? `Fixed ${money(contract.fixed_price_per_kg)}/kg` : "Market price"}
          </Badge>
          <Badge variant="outline" className="font-mono">{cur}</Badge>
          {(() => {
            const st = contractDisplayStatus(contract);
            return (
              <Badge className={contractStatusColors[st.key] ?? ""} variant="outline">
                {st.label}
                {st.key === "season_closed" ? " · history only" : ""}
              </Badge>
            );
          })()}
          <Button variant="ghost" size="icon" className="ml-auto" onClick={printContract} title="Print agreement">
            <Printer className="h-4 w-4" />
          </Button>
        </div>

        <ChainFlow steps={steps} />

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Delivery performance</CardTitle>
          </CardHeader>
          <CardContent>
            {ratio !== null ? (
              <div className="space-y-1">
                <Progress value={Math.min(ratio, 1) * 100} className="h-1.5" />
                <p className="text-xs text-muted-foreground">
                  {deliveredKg.toLocaleString()} / {contract.expected_yield_kg!.toLocaleString()} kg (
                  {Math.round(ratio * 100)}%)
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">—</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Advances</CardTitle>
            <Button size="sm" onClick={() => setAdvanceOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add advance
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Qty × Unit</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Deductible?</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {advances.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.date_issued}</TableCell>
                    <TableCell>
                      {advanceItemLabel(a.item_type)}
                      {a.description ? ` — ${a.description}` : ""}
                    </TableCell>
                    <TableCell>
                      {a.quantity != null ? `${a.quantity}${a.unit ? ` ${a.unit}` : ""} × ${money(a.unit_cost)}` : "—"}
                    </TableCell>
                    <TableCell>{money(a.total_cost)}</TableCell>
                    <TableCell>{a.deduct_at_settlement ? "Yes" : "No"}</TableCell>
                    <TableCell>
                      {a.settlement_id ? (
                        <Badge variant="outline">Settled</Badge>
                      ) : (
                        <Badge variant="secondary">Open</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {canManage && (
                        <Button variant="ghost" size="icon" onClick={() => deleteAdvance(a)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {advances.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No advances yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Deliveries</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Kg</TableHead>
                  <TableHead>Bags</TableHead>
                  <TableHead>Moisture</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.delivery_code}</TableCell>
                    <TableCell>{d.received_date}</TableCell>
                    <TableCell>{d.gross_weight_kg.toLocaleString()}</TableCell>
                    <TableCell>{d.bag_count ?? "—"}</TableCell>
                    <TableCell>
                      {d.moisture_pct == null ? (
                        "—"
                      ) : d.moisture_flagged ? (
                        <Badge variant="destructive">{d.moisture_pct}%</Badge>
                      ) : (
                        `${d.moisture_pct}%`
                      )}
                    </TableCell>
                    <TableCell>{money(d.price_per_kg_applied)}</TableCell>
                    <TableCell>{money(deliveryValue(d))}</TableCell>
                    <TableCell>
                      {d.settlement_id ? (
                        <Badge variant="outline">Settled</Badge>
                      ) : (
                        <Badge variant="secondary">Open</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {deliveries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No deliveries yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Settlements</CardTitle>
            {canManage && (
              <Button size="sm" onClick={() => setSettleOpen(true)} disabled={unsettledDeliveries.length === 0}>
                Prepare payment
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Gross</TableHead>
                  <TableHead>Deductions</TableHead>
                  <TableHead>Net</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {settlements.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.settlement_code}</TableCell>
                    <TableCell>{s.settled_date}</TableCell>
                    <TableCell>{money(s.gross_value)}</TableCell>
                    <TableCell>{money(s.total_deductions)}</TableCell>
                    <TableCell className="font-medium">{money(s.net_payment)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{settlementStatusLabel(s.status)}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {s.status === "draft" && canManage && (
                          <Button variant="outline" size="sm" onClick={() => setPaidTarget(s)}>
                            Mark as paid
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" onClick={() => printSlip(s)} title="Print payment slip" aria-label="Print payment slip">
                          <Printer className="h-4 w-4" />
                        </Button>
                        {canManage && (
                          <Button variant="ghost" size="icon" onClick={() => deleteSettlement(s)} title="Delete payment slip" aria-label="Delete payment slip">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {settlements.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No settlements yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Print target — only visible via @media print, the rest of the page hides.
          printTarget keeps these mutually exclusive so exactly one is on the
          page (and therefore printed) at a time. */}
      <div className="hidden print:block">
        {printTarget === "slip" && printSettlement && (
          <PrintSlip contract={contract} settlement={printSettlement} deliveries={deliveries} advances={advances} />
        )}
        {printTarget === "contract" && <PrintContract contract={contract} />}
      </div>

      <AdvanceDialog open={advanceOpen} onOpenChange={setAdvanceOpen} contractId={contract.id} onDone={reload} />

      <Dialog open={settleOpen} onOpenChange={setSettleOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Prepare payment — {contract.farmers?.full_name ?? contract.contract_code}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <p className="text-sm font-medium mb-1">Deliveries</p>
              <div className="rounded-md border divide-y max-h-40 overflow-y-auto">
                {unsettledDeliveries.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <Checkbox checked={selectedDel.has(d.id)} onCheckedChange={() => toggleDel(d.id)} />
                    <span className="flex-1">
                      {d.delivery_code} — {d.received_date}
                    </span>
                    {untestedDel.has(d.id) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1 border-chart-4 text-chart-4"
                        onClick={(e) => {
                          e.preventDefault();
                          setQcDeliveryId(d.id);
                        }}
                        title="Record the moisture test for this load"
                      >
                        <FlaskConical className="h-3.5 w-3.5" />
                        Record moisture test
                      </Button>
                    )}
                    <span className="tabular-nums text-muted-foreground">{money(deliveryValue(d))}</span>
                  </label>
                ))}
                {unsettledDeliveries.length === 0 && (
                  <p className="px-3 py-2 text-sm text-muted-foreground">No unsettled deliveries</p>
                )}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium mb-1">Advances (deductible)</p>
              <div className="rounded-md border divide-y max-h-40 overflow-y-auto">
                {unsettledAdvances.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <Checkbox checked={selectedAdv.has(a.id)} onCheckedChange={() => toggleAdv(a.id)} />
                    <span className="flex-1">
                      {advanceItemLabel(a.item_type)}
                      {a.description ? ` — ${a.description}` : ""}
                    </span>
                    <span className="tabular-nums text-muted-foreground">{money(a.total_cost)}</span>
                  </label>
                ))}
                {unsettledAdvances.length === 0 && (
                  <p className="px-3 py-2 text-sm text-muted-foreground">No deductible advances</p>
                )}
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Gross</span>
                <span>{money(settleTotals.gross)}</span>
              </div>
              <div className="flex justify-between">
                <span>Deductions</span>
                <span>-{money(settleTotals.deductions)}</span>
              </div>
              <div className="flex justify-between font-semibold text-base border-t pt-1">
                <span>Net</span>
                <span>{money(settleTotals.net)}</span>
              </div>
            </div>
            {untestedSelectedCount > 0 && (
              <p className="text-sm text-chart-4 flex items-start gap-1.5">
                <FlaskConical className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  {untestedSelectedCount === 1 ? "1 selected load has" : `${untestedSelectedCount} selected loads have`} no
                  moisture test. The farmer is paid after the moisture test — tap "Record moisture test" beside the
                  load, or untick it. The{" "}
                  <Link to="/deliveries" search={{ new: undefined }} className="underline">
                    Deliveries page
                  </Link>{" "}
                  has the same button.
                </span>
              </p>
            )}
            <Button
              className="w-full"
              onClick={handleSettle}
              disabled={selectedDel.size === 0 || untestedSelectedCount > 0 || settling}
            >
              {settling ? "Saving..." : "Save payment slip"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <MarkPaidDialog
        settlement={paidTarget}
        farmerName={contract.farmers?.full_name ?? contract.contract_code}
        money={money}
        onClose={() => setPaidTarget(null)}
        onConfirm={markPaid}
      />

      <QcDialog
        open={qcDeliveryId !== null}
        onOpenChange={(o) => !o && setQcDeliveryId(null)}
        deliveryId={qcDeliveryId ?? undefined}
        onChanged={reload}
      />

      {confirmDialog}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Add advance                                                         */
/* ------------------------------------------------------------------ */

function AdvanceDialog({
  open,
  onOpenChange,
  contractId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contractId: string;
  onDone: () => void;
}) {
  const [itemType, setItemType] = useState("fertilizer");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [totalCost, setTotalCost] = useState("");
  const [totalTouched, setTotalTouched] = useState(false);
  const [dateIssued, setDateIssued] = useState(today());
  const [deduct, setDeduct] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setItemType("fertilizer");
      setDescription("");
      setQuantity("");
      setUnit("");
      setUnitCost("");
      setTotalCost("");
      setTotalTouched(false);
      setDateIssued(today());
      setDeduct(true);
    }
  }, [open]);

  // Auto total_cost = round2(quantity * unit_cost), unless the user has
  // typed directly into the total field (manual override). Clearing either
  // input drops back to empty instead of leaving a stale computed total.
  useEffect(() => {
    if (totalTouched) return;
    const q = parseFloat(quantity);
    const u = parseFloat(unitCost);
    setTotalCost(!isNaN(q) && !isNaN(u) ? String(round2(q * u)) : "");
  }, [quantity, unitCost, totalTouched]);

  const save = async () => {
    const total = parseFloat(totalCost);
    if (!total || total <= 0) {
      toast.error("Total cost is required.");
      return;
    }
    setSaving(true);
    const payload: AdvanceInsert = {
      contract_id: contractId,
      item_type: itemType,
      description: description.trim() || null,
      quantity: quantity ? parseFloat(quantity) : null,
      unit: unit.trim() || null,
      unit_cost: unitCost ? parseFloat(unitCost) : null,
      total_cost: round2(total),
      date_issued: dateIssued,
      deduct_at_settlement: deduct,
    };
    const { error } = await supabase.from("input_advances").insert(payload);
    setSaving(false);
    if (!ok(error, "Add advance")) return;
    toast.success("Advance recorded");
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add advance</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div>
            <Label>Item type</Label>
            <Select value={itemType} onValueChange={setItemType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="seed">Seed</SelectItem>
                <SelectItem value="fertilizer">Fertilizer</SelectItem>
                <SelectItem value="diesel">Diesel (pump fuel)</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Quantity</Label>
              <Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div>
              <Label>Unit</Label>
              <Input placeholder="kg, bags..." value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Unit cost ($)</Label>
              <Input type="number" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
            </div>
            <div>
              <Label>Total cost ($) *</Label>
              <Input
                type="number"
                step="0.01"
                value={totalCost}
                onChange={(e) => {
                  setTotalCost(e.target.value);
                  setTotalTouched(true);
                }}
              />
            </div>
          </div>
          <div>
            <Label>Date issued</Label>
            <Input type="date" value={dateIssued} onChange={(e) => setDateIssued(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={deduct} onCheckedChange={(v) => setDeduct(v === true)} />
            Deduct at settlement
          </label>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Add advance"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Mark settlement paid                                                */
/* ------------------------------------------------------------------ */

function MarkPaidDialog({
  settlement,
  farmerName,
  money,
  onClose,
  onConfirm,
}: {
  settlement: Settlement | null;
  farmerName: string;
  money: (n: number | null | undefined) => string;
  onClose: () => void;
  onConfirm: (settlement: Settlement, method: string, reference: string) => Promise<void>;
}) {
  const [method, setMethod] = useState<string>("Cash");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settlement) {
      setMethod("Cash");
      setReference("");
    }
  }, [settlement]);

  const save = async () => {
    if (!settlement) return;
    setSaving(true);
    await onConfirm(settlement, method, reference);
    setSaving(false);
  };

  return (
    <Dialog open={settlement !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Mark as paid — {farmerName}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Slip</span>
              <span className="font-mono">{settlement?.settlement_code}</span>
            </div>
            <div className="flex justify-between font-semibold text-base">
              <span>Net to farmer</span>
              <span>{money(settlement?.net_payment)}</span>
            </div>
          </div>
          <div>
            <Label>Paid by</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Reference</Label>
            <Input
              className="h-11"
              placeholder="Transfer number, receipt number, or who handed over the cash"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
          <Button className="h-11" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Confirm: farmer has been paid"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Print slip                                                          */
/* ------------------------------------------------------------------ */

function PrintSlip({
  contract,
  settlement,
  deliveries,
  advances,
}: {
  contract: ContractWithFarmer;
  settlement: Settlement;
  deliveries: Delivery[];
  advances: Advance[];
}) {
  const money = (n: number | null | undefined) => fmtMoney(n, asCurrency(contract.currency));
  const dels = deliveries.filter((d) => d.settlement_id === settlement.id);
  const advs = advances.filter((a) => a.settlement_id === settlement.id);
  return (
    <div className="p-8 text-sm text-black">
      <h1 className="text-xl font-bold">BRM Agro</h1>
      <h2 className="text-lg font-semibold mt-1">Settlement Slip — {settlement.settlement_code}</h2>
      <p className="text-muted-foreground">{settlement.settled_date}</p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div>
          <span className="font-medium">Farmer:</span>{" "}
          {contract.farmers ? `${contract.farmers.full_name} (${contract.farmers.farmer_code})` : "—"}
        </div>
        <div>
          <span className="font-medium">Contract:</span> {contract.contract_code} — {contract.season_label}
        </div>
      </div>

      <table className="w-full mt-6 border-collapse">
        <thead>
          <tr className="border-b">
            <th className="text-left py-1">Date</th>
            <th className="text-left py-1">Kg</th>
            <th className="text-left py-1">Price</th>
            <th className="text-right py-1">Value</th>
          </tr>
        </thead>
        <tbody>
          {dels.map((d) => (
            <tr key={d.id} className="border-b">
              <td className="py-1">{d.received_date}</td>
              <td className="py-1">{d.gross_weight_kg.toLocaleString()}</td>
              <td className="py-1">{money(d.price_per_kg_applied)}</td>
              <td className="text-right py-1">{money(deliveryValue(d))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="w-full mt-6 border-collapse">
        <thead>
          <tr className="border-b">
            <th className="text-left py-1">Date</th>
            <th className="text-left py-1">Item</th>
            <th className="text-right py-1">Cost</th>
          </tr>
        </thead>
        <tbody>
          {advs.map((a) => (
            <tr key={a.id} className="border-b">
              <td className="py-1">{a.date_issued}</td>
              <td className="py-1">
                {advanceItemLabel(a.item_type)}
                {a.description ? ` — ${a.description}` : ""}
              </td>
              <td className="text-right py-1">{money(a.total_cost)}</td>
            </tr>
          ))}
          {advs.length === 0 && (
            <tr>
              <td colSpan={3} className="py-1 text-muted-foreground">
                None
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="mt-6 space-y-1 text-right">
        <div>Gross: {money(settlement.gross_value)}</div>
        <div>Deductions: -{money(settlement.total_deductions)}</div>
        <div className="font-bold text-base">Net: {money(settlement.net_payment)}</div>
      </div>

      <div className="mt-16 grid grid-cols-2 gap-8">
        <div className="border-t pt-1">Received by farmer</div>
        <div className="border-t pt-1">Paid by</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Print contract — bilingual purchase agreement                      */
/* ------------------------------------------------------------------ */

// Khmer strings here are machine-drafted, NOT reviewed by a native speaker —
// native review pending. The body font stack already carries "Noto Sans
// Khmer" (src/styles.css), but this print output leaves the app chrome
// entirely, so the stack is repeated explicitly rather than relied on by
// inheritance alone; `leading-relaxed` keeps Khmer subscript conjuncts from
// clipping under a tight line-height.
const PRINT_FONT_STACK =
  '"Noto Sans Khmer", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function PrintContract({ contract }: { contract: ContractWithFarmer }) {
  const farmer = contract.farmers;
  const addressParts = farmer
    ? [farmer.village, farmer.commune, farmer.district, farmer.province].filter((p): p is string => !!p)
    : [];

  const priceValue =
    contract.price_mode === "fixed"
      ? contract.fixed_price_per_kg != null
        ? `$${contract.fixed_price_per_kg.toFixed(3)} per kg (fixed / ថេរ)`
        : "— (fixed / ថេរ)"
      : "Market price at delivery / តម្លៃទីផ្សារនៅពេលប្រគល់";

  return (
    <div className="p-8 text-sm text-black leading-relaxed" style={{ fontFamily: PRINT_FONT_STACK }}>
      <h1 className="text-xl font-bold">BRM Agro — Purchase Agreement / កិច្ចព្រមព្រៀងទិញ</h1>
      <p className="text-base font-semibold mt-1">{contract.contract_code}</p>
      <p className="text-muted-foreground">Signed: {contract.signed_date ?? "—"}</p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div>
          <span className="font-medium">Company:</span> BRM Agro Co., Ltd.
        </div>
        <div>
          <span className="font-medium">Farmer:</span>{" "}
          {farmer ? `${farmer.full_name} (${farmer.farmer_code})` : "—"}
          {farmer && addressParts.length > 0 && <div>{addressParts.join(", ")}</div>}
          {farmer?.national_id_or_reference && <div>ID: {farmer.national_id_or_reference}</div>}
        </div>
      </div>

      <table className="w-full mt-6 border-collapse">
        <tbody>
          <tr className="border-b">
            <td className="py-1 font-medium">Crop / ដំណាំ</td>
            <td className="py-1 text-right capitalize">{contract.crop_type || "—"}</td>
          </tr>
          <tr className="border-b">
            <td className="py-1 font-medium">Season / រដូវ</td>
            <td className="py-1 text-right">{contract.season_label}</td>
          </tr>
          <tr className="border-b">
            <td className="py-1 font-medium">Grower type / ប្រភេទកសិករ</td>
            <td className="py-1 text-right capitalize">{contract.grower_type || "—"}</td>
          </tr>
          <tr className="border-b">
            <td className="py-1 font-medium">Contracted hectares / ហិកតា</td>
            <td className="py-1 text-right">{contract.contracted_hectares?.toLocaleString() ?? "—"}</td>
          </tr>
          <tr className="border-b">
            <td className="py-1 font-medium">Expected yield (kg) / ទិន្នផលរំពឹងទុក</td>
            <td className="py-1 text-right">{contract.expected_yield_kg?.toLocaleString() ?? "—"}</td>
          </tr>
          <tr className="border-b">
            <td className="py-1 font-medium">Price / តម្លៃ</td>
            <td className="py-1 text-right">{priceValue}</td>
          </tr>
        </tbody>
      </table>

      <p className="mt-3 text-xs text-muted-foreground">
        Input advances are deducted at settlement / បុរេប្រទានត្រូវកាត់ចេញនៅពេលទូទាត់
      </p>

      <div className="mt-16 grid grid-cols-2 gap-8">
        <div>
          <div className="border-t pt-1">Company representative / តំណាងក្រុមហ៊ុន</div>
          <div className="mt-8 border-t pt-1 text-xs text-muted-foreground">Date</div>
        </div>
        <div>
          <div className="border-t pt-1">Farmer (signature or thumbprint) / កសិករ (ហត្ថលេខា ឬ ស្នាមមេដៃ)</div>
          <div className="mt-8 border-t pt-1 text-xs text-muted-foreground">Date</div>
        </div>
      </div>

      <p className="mt-12 text-xs text-muted-foreground">Generated by Field Watch — {new Date().toLocaleString()}</p>
    </div>
  );
}
