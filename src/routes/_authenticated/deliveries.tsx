// Delivery intake: list + dialog. Mirrors contracts.tsx (list/dialog skeleton)
// and the AdvanceDialog "touched" pattern from contracts_.$contractId.tsx —
// here it guards the price-autofill effect instead of a computed total.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ok } from "@/lib/supabase-helpers";
import { capped, FETCH_LIMIT } from "@/lib/query-limits";
import { RowCapNotice } from "@/components/row-cap-notice";
import { newCode, useOffline } from "@/lib/offline";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, FlaskConical } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { deliveryValue, genCode, latestPriceFor, moistureFlagged, type PriceRow } from "@/lib/trade-core";
import { matchContracts } from "@/lib/contract-core";
import { asCurrency, fmtMoney, usdEquivalent } from "@/lib/money-core";
import { useFx } from "@/lib/fx";
import { QcDialog } from "@/components/qc";

type Delivery = Database["public"]["Tables"]["deliveries"]["Row"];
type DeliveryInsert = Database["public"]["Tables"]["deliveries"]["Insert"];
type Contract = Database["public"]["Tables"]["contracts"]["Row"];
type FarmerLite = { full_name: string; farmer_code: string };
type ContractLite = Contract & { farmers: FarmerLite | null };
type DeliveryWithContract = Delivery & {
  batches: { batch_code: string } | null;
  contracts: (Pick<Contract, "contract_code" | "season_label" | "price_mode" | "currency" | "season_closed"> & { farmers: FarmerLite | null }) | null;
};

export const Route = createFileRoute("/_authenticated/deliveries")({
  // `?new=1` lands with the record dialog already open — the home page's
  // "Record delivery" button points here, so the user's next tap is the form,
  // not a hunt for a button they already pressed once.
  validateSearch: (search: Record<string, unknown>) => ({
    new: search.new === 1 || search.new === "1" ? 1 : undefined,
  }),
  component: DeliveriesPage,
});

const today = () => new Date().toISOString().slice(0, 10);

function DeliveriesPage() {
  const { khrPerUsd } = useFx();
  const { user } = useAuth();
  const { confirm, confirmDialog } = useConfirm();

  const [deliveries, setDeliveries] = useState<DeliveryWithContract[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [contracts, setContracts] = useState<ContractLite[]>([]);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [filter, setFilter] = useState<"all" | "flagged" | "unsettled">("all");
  const search = Route.useSearch();
  const [dialogOpen, setDialogOpen] = useState(search.new === 1);
  const [qcDeliveryId, setQcDeliveryId] = useState<string | null>(null);

  const load = async () => {
    const { data, error } = await supabase
      .from("deliveries")
      .select("*, contracts(contract_code, season_label, price_mode, currency, season_closed, farmers(full_name, farmer_code)), batches(batch_code)")
      .order("received_date", { ascending: false })
      .limit(FETCH_LIMIT);
    ok(error, "Load deliveries");
    const page = capped((data as unknown as DeliveryWithContract[]) || []);
    setDeliveries(page.rows);
    setTruncated(page.truncated);
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    supabase
      .from("contracts")
      .select("*, farmers(full_name, farmer_code)")
      .eq("status", "active")
      .order("contract_code")
      .then(({ data, error }) => {
        ok(error, "Load contracts");
        setContracts((data as unknown as ContractLite[]) || []);
      });
    supabase
      .from("market_prices")
      .select("price_date, crop_type, price_per_kg")
      .then(({ data, error }) => {
        ok(error, "Load prices");
        setPrices(data || []);
      });
  }, []);

  // Datalist for the intake variety field: whatever has already been typed.
  const varieties = useMemo(
    () => [...new Set(deliveries.map((d) => d.variety).filter((v): v is string => !!v))].sort(),
    [deliveries],
  );

  const visible = useMemo(() => {
    if (filter === "flagged") return deliveries.filter((d) => d.moisture_flagged);
    if (filter === "unsettled") return deliveries.filter((d) => d.settlement_id === null);
    return deliveries;
  }, [deliveries, filter]);

  const handleDelete = async (d: DeliveryWithContract) => {
    if (d.settlement_id) {
      toast.error("Settled — unsettle first by deleting the settlement.");
      return;
    }
    const confirmed = await confirm({
      title: `Delete ${d.delivery_code}?`,
      description: "This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    const { error } = await supabase.from("deliveries").delete().eq("id", d.id);
    if (!ok(error, "Delete delivery")) return;
    toast.success("Delivery deleted");
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Deliveries</h1>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Record delivery
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="flagged">Flagged moisture</SelectItem>
              <SelectItem value="unsettled">Unsettled</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <RowCapNotice show={truncated} noun="deliveries" />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Farmer</TableHead>
                  <TableHead>Contract</TableHead>
                  <TableHead>Kg</TableHead>
                  <TableHead>Bags</TableHead>
                  <TableHead>Moisture</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead className="text-right">Price /kg</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Settled</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead className="sticky right-0 bg-card">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="num whitespace-nowrap font-medium">{d.delivery_code}</TableCell>
                    <TableCell className="num whitespace-nowrap">{d.received_date}</TableCell>
                    <TableCell>
                      {d.contracts?.farmers
                        ? `${d.contracts.farmers.full_name} (${d.contracts.farmers.farmer_code})`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {d.contracts ? (
                        <Link
                          to="/contracts/$contractId"
                          params={{ contractId: d.contract_id }}
                          className="font-medium text-primary hover:underline"
                        >
                          {d.contracts.contract_code}
                        </Link>
                      ) : (
                        "—"
                      )}
                      {d.contracts?.season_closed && (
                        <span className="ml-1.5 text-xs text-muted-foreground">season closed</span>
                      )}
                    </TableCell>
                    <TableCell>{d.gross_weight_kg.toLocaleString()}</TableCell>
                    <TableCell>{d.bag_count ?? "—"}</TableCell>
                    <TableCell>
                      {d.moisture_pct == null ? (
                        "—"
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span>{d.moisture_pct}%</span>
                          {d.moisture_flagged && <Badge variant="destructive">&gt;24% wet · dry before milling</Badge>}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{d.grade ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap">
                      {fmtMoney(d.price_per_kg_applied, asCurrency(d.contracts?.currency))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap">
                      {fmtMoney(deliveryValue(d), asCurrency(d.contracts?.currency))}
                      {d.contracts?.currency === "KHR" && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ≈ {fmtMoney(usdEquivalent(deliveryValue(d), "KHR", khrPerUsd), "USD")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {d.settlement_id ? (
                        <Badge variant="outline">Settled</Badge>
                      ) : (
                        <Badge variant="secondary">Open</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {d.batch_id && d.batches ? (
                        <Link
                          to="/batches/$batchId"
                          params={{ batchId: d.batch_id }}
                          className="font-medium text-primary hover:underline"
                        >
                          {d.batches.batch_code}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="sticky right-0 bg-card">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setQcDeliveryId(d.id)}
                        title="Quality tests for this load"
                        aria-label="Quality tests for this load"
                      >
                        <FlaskConical className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(d)}
                        title="Delete delivery"
                        aria-label="Delete delivery"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {visible.length === 0 && (
            <div className="text-center py-10">
              <p className="text-muted-foreground mb-3">No deliveries yet. Record each load as it arrives.</p>
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Record delivery
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <IntakeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        contracts={contracts}
        prices={prices}
        varieties={varieties}
        userId={user?.id ?? null}
        onDone={load}
      />
      <QcDialog
        open={qcDeliveryId !== null}
        onOpenChange={(o) => {
          if (!o) setQcDeliveryId(null);
        }}
        deliveryId={qcDeliveryId ?? undefined}
      />
      {confirmDialog}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Intake dialog                                                       */
/* ------------------------------------------------------------------ */

function IntakeDialog({
  open,
  onOpenChange,
  contracts,
  prices,
  varieties,
  userId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contracts: ContractLite[];
  prices: PriceRow[];
  varieties: string[];
  userId: string | null;
  onDone: () => void;
}) {
  const [form, setForm] = useState<Partial<DeliveryInsert>>({});
  const [query, setQuery] = useState("");
  const [priceTouched, setPriceTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const { save: saveRow } = useOffline();
  const [deliveredKg, setDeliveredKg] = useState(0);

  useEffect(() => {
    if (open) {
      setForm({ received_date: today(), bag_count: null, moisture_pct: null, quality_notes: null });
      setQuery("");
      setPriceTouched(false);
      setDeliveredKg(0);
    }
  }, [open]);

  // Farmer-first search: the clerk knows a face and a truck, not a contract
  // code. Every active contract is searchable by farmer name, farmer code or
  // contract code; one farmer's seasons sit together in the list.
  const searchRows = useMemo(
    () =>
      contracts.map((c) => ({
        id: c.id,
        contract_code: c.contract_code,
        season_label: c.season_label,
        farmer_name: c.farmers?.full_name ?? null,
        farmer_code: c.farmers?.farmer_code ?? null,
      })),
    [contracts],
  );
  const matches = useMemo(() => matchContracts(searchRows, query, 8), [searchRows, query]);

  // Expected-vs-delivered gate: whenever the chosen contract changes, pull
  // every delivery already recorded against it (settled ones included — they
  // still count toward the contract's total) and sum client-side. This is a
  // warning aid only; it never blocks save, so a stale total from a slow
  // fetch is an acceptable, self-correcting risk.
  useEffect(() => {
    if (!form.contract_id) {
      setDeliveredKg(0);
      return;
    }
    let cancelled = false;
    supabase
      .from("deliveries")
      .select("gross_weight_kg")
      .eq("contract_id", form.contract_id)
      .then(({ data, error }) => {
        if (cancelled) return;
        ok(error, "Load contract delivered total");
        setDeliveredKg((data ?? []).reduce((sum, d) => sum + d.gross_weight_kg, 0));
      });
    return () => {
      cancelled = true;
    };
  }, [form.contract_id]);

  // Price autofill — runs when contract or date changes. Guarded by
  // priceTouched so a manual override (e.g. a quality discount) survives
  // until the user picks a different contract/date, at which point the
  // handlers below reset the flag and this recomputes.
  useEffect(() => {
    if (priceTouched) return;
    const c = contracts.find((x) => x.id === form.contract_id);
    if (!c) return;
    if (c.price_mode === "fixed") {
      setForm((f) => ({ ...f, price_per_kg_applied: c.fixed_price_per_kg ?? 0, price_source: "fixed" }));
    } else {
      const p = latestPriceFor(prices, c.crop_type, form.received_date ?? today());
      setForm((f) => ({ ...f, price_per_kg_applied: p ?? 0, price_source: "market" }));
      if (p === null) toast.warning("No market price on file for this crop/date — enter one on Prices.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.contract_id, form.received_date, priceTouched]);

  const num = (v: string) => (v === "" ? null : Number(v));

  const flagged = moistureFlagged(form.moisture_pct);
  const showValue = (form.gross_weight_kg ?? 0) > 0 && form.price_per_kg_applied !== undefined;
  const selectedContract = contracts.find((c) => c.id === form.contract_id);
  const selectedCurrency = asCurrency(selectedContract?.currency);
  const expectedKg = selectedContract?.expected_yield_kg ?? null;
  const currentWeight = form.gross_weight_kg ?? 0;
  const totalKg = deliveredKg + currentWeight;
  const overContract = expectedKg != null && totalKg > expectedKg;

  const pickContract = (id: string) => {
    setForm((f) => ({ ...f, contract_id: id }));
    setPriceTouched(false);
    setQuery("");
    // Varieties dry separately (mill manager, 8 Sep 2026). Default the variety from
    // the farm's newest crop cycle; the clerk can overtype it.
    const c = contracts.find((x) => x.id === id);
    if (c?.farm_id) {
      supabase
        .from("crop_cycles")
        .select("seed_variety")
        .eq("farm_id", c.farm_id)
        .order("planting_date", { ascending: false })
        .limit(1)
        .then(({ data }) => {
          const v = data?.[0]?.seed_variety?.trim();
          if (v) setForm((f) => (f.variety ? f : { ...f, variety: v }));
        });
    }
  };
  const clearContract = () => {
    setForm((f) => ({ ...f, contract_id: undefined }));
    setPriceTouched(false);
  };

  const save = async () => {
    if (!form.contract_id) {
      toast.error("Choose the farmer first.");
      return;
    }
    if (!form.gross_weight_kg || form.gross_weight_kg <= 0) {
      toast.error("Gross weight is required.");
      return;
    }
    setSaving(true);
    // The id is minted here so the moisture test below can point at this
    // delivery even when both rows wait in the phone's outbox.
    const deliveryId = crypto.randomUUID();
    const code = newCode("DL");
    const payload: DeliveryInsert = {
      ...form,
      id: deliveryId,
      contract_id: form.contract_id,
      gross_weight_kg: form.gross_weight_kg,
      // Device-tagged so two phones weighing at the same second offline
      // cannot mint the same code.
      delivery_code: code,
      received_by: userId,
    };
    // Goes straight to the database with signal; to the phone's outbox
    // without it. Either way the officer gets one clear answer.
    const { queued, error } = await saveRow("deliveries", payload as unknown as Record<string, unknown>);
    if (error) {
      setSaving(false);
      toast.error(`Record delivery: ${error}`);
      return;
    }

    // One entry, one gate: a moisture reading typed at the weighbridge is the
    // moisture test the payment step looks for. Nobody has to find the flask
    // icon afterwards. Pass/fail follows the 24% drying rule; a wet load is
    // still bought.
    const pct = form.moisture_pct ?? null;
    let testError: string | null = null;
    if (pct !== null) {
      const test = {
        delivery_id: deliveryId,
        test_type: "moisture",
        result_value: pct,
        passed: !moistureFlagged(pct),
        tested_date: form.received_date ?? today(),
        method: "At intake",
        recorded_by: userId,
      };
      const res = await saveRow("qc_tests", test);
      testError = res.error;
    }
    setSaving(false);

    if (queued) {
      toast.success("Delivery saved on this phone — will send when there is signal");
    } else if (testError) {
      toast.warning(`${code} recorded, but the moisture test did not save (${testError}). Record it from the flask icon.`);
    } else if (pct === null) {
      toast.success(`${code} recorded. No moisture reading yet — record the test before paying the farmer.`);
    } else if (flagged) {
      toast.success(`${code} recorded. Moisture ${pct}% saved as the test. Above 24%: dry before milling.`);
    } else {
      toast.success(`${code} recorded. Moisture ${pct}% saved as the test — ready to pay.`);
    }
    onOpenChange(false);
    onDone();
  };

  const sectionTitle = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record delivery</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          {/* Farmer */}
          <section className="space-y-2">
            <p className={sectionTitle}>Farmer</p>
            {selectedContract ? (
              <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-tight truncate">
                    {selectedContract.farmers?.full_name ?? "—"}
                    {selectedContract.farmers?.farmer_code ? (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        {selectedContract.farmers.farmer_code}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {selectedContract.contract_code} · {selectedContract.season_label} · {selectedCurrency}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={clearContract}>
                  Change
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Input
                  autoFocus
                  className="h-11"
                  placeholder="Farmer name, code, or contract"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Find the farmer"
                />
                <div className="rounded-md border divide-y max-h-56 overflow-y-auto">
                  {matches.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => pickContract(m.id)}
                      className="flex w-full items-baseline justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none min-h-11"
                    >
                      <span className="font-medium truncate">{m.farmer_name ?? "—"}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {m.contract_code} · {m.season_label}
                      </span>
                    </button>
                  ))}
                  {matches.length === 0 && (
                    <p className="px-3 py-3 text-sm text-muted-foreground">
                      {contracts.length === 0
                        ? "No active contracts. Create one on the Contracts page first."
                        : "No farmer matches that. Try the farmer code or the contract code."}
                    </p>
                  )}
                </div>
              </div>
            )}
            {expectedKg != null && (
              <div className="space-y-1">
                <Progress value={Math.min(100, (totalKg / expectedKg) * 100)} className="h-1.5" />
                <p className="text-xs text-muted-foreground">
                  Delivered {deliveredKg.toLocaleString()} + this load = {totalKg.toLocaleString()} / {expectedKg.toLocaleString()} kg
                </p>
                {overContract && (
                  <p className="text-xs text-destructive">
                    Over contract: exceeds expected yield by {(totalKg - expectedKg).toLocaleString()} kg. Record only if
                    the mill approved the extra volume.
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Load */}
          <section className="space-y-3">
            <p className={sectionTitle}>Load</p>
            <div>
              <Label htmlFor="intake-moisture">Moisture (%)</Label>
              <Input
                id="intake-moisture"
                className="h-11"
                type="number"
                inputMode="decimal"
                step="0.1"
                placeholder="Meter reading"
                value={form.moisture_pct ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, moisture_pct: num(e.target.value) }))}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Saved as the moisture test. The farmer is paid after this reading.
              </p>
              {flagged && (
                <div className="mt-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  Moisture above 24% — load must be dried before milling. Flag stays on the record.
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="intake-variety">Variety</Label>
              <Input
                id="intake-variety"
                className="h-11"
                list="intake-varieties"
                placeholder="e.g. Sen Kra Ob"
                value={form.variety ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, variety: e.target.value || null }))}
              />
              <datalist id="intake-varieties">
                {varieties.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
              <p className="mt-1 text-xs text-muted-foreground">
                Varieties dry separately. A load can only join a batch of the same variety.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="intake-weight">Gross weight (kg) *</Label>
                <Input
                  id="intake-weight"
                  className="h-11"
                  type="number"
                  inputMode="decimal"
                  value={form.gross_weight_kg ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, gross_weight_kg: num(e.target.value) ?? undefined }))}
                />
              </div>
              <div>
                <Label htmlFor="intake-bags">Bag count</Label>
                <Input
                  id="intake-bags"
                  className="h-11"
                  type="number"
                  inputMode="numeric"
                  value={form.bag_count ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, bag_count: num(e.target.value) }))}
                />
              </div>
              <div>
                <Label htmlFor="intake-date">Received date</Label>
                <Input
                  id="intake-date"
                  className="h-11"
                  type="date"
                  value={form.received_date ?? ""}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, received_date: e.target.value }));
                    setPriceTouched(false);
                  }}
                />
              </div>
            </div>
          </section>

          {/* Office */}
          <section className="space-y-3">
            <p className={sectionTitle}>Office</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Grade</Label>
                <Select
                  value={form.grade ?? "none"}
                  onValueChange={(v) => setForm((f) => ({ ...f, grade: v === "none" ? null : v }))}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not graded</SelectItem>
                    <SelectItem value="A">A</SelectItem>
                    <SelectItem value="B">B</SelectItem>
                    <SelectItem value="C">C</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="intake-price">Price applied ({selectedCurrency}/kg)</Label>
                <Input
                  id="intake-price"
                  className="h-11"
                  type="number"
                  inputMode="decimal"
                  step="0.001"
                  value={form.price_per_kg_applied ?? ""}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, price_per_kg_applied: num(e.target.value) ?? undefined }));
                    setPriceTouched(true);
                  }}
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="intake-notes">Quality notes</Label>
                <Textarea
                  id="intake-notes"
                  value={form.quality_notes ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, quality_notes: e.target.value }))}
                />
              </div>
            </div>
            {showValue && (
              <p className="text-sm text-muted-foreground">
                Value: {fmtMoney(deliveryValue({ gross_weight_kg: form.gross_weight_kg ?? 0, price_per_kg_applied: form.price_per_kg_applied ?? 0 }), selectedCurrency)}
              </p>
            )}
          </section>
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="h-11" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Record delivery"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
