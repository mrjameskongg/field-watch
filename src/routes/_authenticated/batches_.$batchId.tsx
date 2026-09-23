// Batch detail: the "where is this rice" timeline. Deliveries in, weigh points
// through drying and milling, measured losses instead of the estimated 20%.
// Custody rule enforced at attach time: identity_preserved batches take one
// farmer's deliveries only.

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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, AlertTriangle, Link2, Plus, QrCode, Scale, Trash2, Truck } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import {
  BATCH_STATUSES,
  batchMath,
  DEFAULT_KG_PER_BAG,
  estimatedWeight,
  isEstimated,
  mixesFarmers,
  MOISTURE_STAGES,
  stageLabel,
  STAGES,
  stageTotals,
  varietyBlocks,
} from "@/lib/batch-core";
import { batchStatusColors, custodyShort } from "./batches";
import { BatchLabel } from "@/components/qr";

type Batch = Database["public"]["Tables"]["batches"]["Row"];
type WeighPoint = Database["public"]["Tables"]["batch_weigh_points"]["Row"];
type Delivery = Database["public"]["Tables"]["deliveries"]["Row"];
type DeliveryWithFarmer = Delivery & {
  contracts: { id: string; contract_code: string; farmers: { id: string; full_name: string } | null } | null;
};

export const Route = createFileRoute("/_authenticated/batches_/$batchId")({
  component: BatchDetailPage,
});

const today = () => new Date().toISOString().slice(0, 10);
const fmtKg = (n: number) => `${n.toLocaleString()} kg`;
/** "≈" in front of any figure that rests on an estimated weight (bags, not a scale). */
const about = (estimated: boolean, text: string) => (estimated ? `≈ ${text}` : text);

function BatchDetailPage() {
  const { batchId } = Route.useParams();
  const { user, hasRole } = useAuth();
  const canManage = hasRole("admin") || hasRole("manager");
  const { confirm, confirmDialog } = useConfirm();

  const [batch, setBatch] = useState<Batch | null>(null);
  const [points, setPoints] = useState<WeighPoint[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryWithFarmer[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [weighOpen, setWeighOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);

  const reload = useCallback(async () => {
    const [b, p, d, profiles] = await Promise.all([
      supabase.from("batches").select("*").eq("id", batchId).single(),
      supabase
        .from("batch_weigh_points")
        .select("*")
        .eq("batch_id", batchId)
        .order("recorded_date", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("deliveries")
        .select("*, contracts(id, contract_code, farmers(id, full_name))")
        .eq("batch_id", batchId)
        .order("received_date", { ascending: true }),
      supabase.from("profiles").select("user_id, full_name"),
    ]);
    setLoaded(true);
    if (!ok(b.error, "Load batch")) return;
    setBatch(b.data ?? null);
    if (!ok(p.error, "Load weigh points")) return;
    setPoints(p.data ?? []);
    if (!ok(d.error, "Load deliveries")) return;
    setDeliveries((d.data as unknown as DeliveryWithFarmer[]) ?? []);
    const map: Record<string, string> = {};
    (profiles.data ?? []).forEach((pr) => {
      if (pr.full_name) map[pr.user_id] = pr.full_name;
    });
    setNames(map);
  }, [batchId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // The QR points at the public trace page. On the deployed app that is this
  // same origin; in dev it still resolves so the printed code is testable.
  const traceUrl = useMemo(
    () => (typeof window === "undefined" ? "" : `${window.location.origin}/trace/${batch?.batch_code ?? ""}`),
    [batch?.batch_code],
  );

  const math = useMemo(() => batchMath(points), [points]);
  const totals = useMemo(() => stageTotals(points), [points]);
  const deliveredKg = useMemo(() => deliveries.reduce((s, d) => s + d.gross_weight_kg, 0), [deliveries]);

  const setStatus = async (status: string) => {
    const { error } = await supabase
      .from("batches")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", batchId);
    if (!ok(error, "Update batch status")) return;
    toast.success(`Status: ${status}`);
    reload();
  };

  const deletePoint = async (wp: WeighPoint) => {
    const okToDelete = await confirm({
      title: `Delete ${stageLabel(wp.stage)} — ${fmtKg(wp.weight_kg)}?`,
      description: "Cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!okToDelete) return;
    const { error } = await supabase.from("batch_weigh_points").delete().eq("id", wp.id);
    if (!ok(error, "Delete weigh point")) return;
    toast.success("Weigh point deleted");
    reload();
  };

  const detachDelivery = async (d: DeliveryWithFarmer) => {
    const okToDetach = await confirm({
      title: `Remove ${d.delivery_code} from this batch?`,
      description: "The delivery itself is kept and goes back to unbatched.",
      confirmLabel: "Remove",
    });
    if (!okToDetach) return;
    const { error } = await supabase.from("deliveries").update({ batch_id: null }).eq("id", d.id);
    if (!ok(error, "Detach delivery")) return;
    toast.success("Delivery removed from batch");
    reload();
  };

  // Timeline = deliveries (intake) + weigh points, in date order, numbered.
  type TimelineItem = {
    key: string;
    date: string;
    title: string;
    who: string;
    detail: string;
    moisture: number | null;
    isDelivery: boolean;
    point?: WeighPoint;
  };
  const timeline: TimelineItem[] = useMemo(() => {
    const items: TimelineItem[] = [
      ...deliveries.map((d) => ({
        key: `del-${d.id}`,
        date: d.received_date,
        title: `Delivery ${d.delivery_code} attached`,
        who: d.contracts?.farmers?.full_name ?? "Unknown farmer",
        detail: `${fmtKg(d.gross_weight_kg)} · contract ${d.contracts?.contract_code ?? "—"}`,
        moisture: d.moisture_pct,
        isDelivery: true,
      })),
      ...points.map((p) => ({
        key: `wp-${p.id}`,
        date: p.recorded_date,
        title: stageLabel(p.stage),
        who: p.recorded_by ? (names[p.recorded_by] ?? "Staff") : "—",
        detail: `${p.estimated ? "≈ " : ""}${fmtKg(p.weight_kg)}${
          p.bag_count ? ` · ${p.bag_count} bags × ${p.kg_per_bag ?? DEFAULT_KG_PER_BAG} kg` : ""
        }${p.estimated ? " · estimated, not weighed" : ""}${p.notes ? ` · ${p.notes}` : ""}`,
        moisture: p.moisture_pct,
        isDelivery: false,
        point: p,
      })),
    ];
    return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.isDelivery === b.isDelivery ? 0 : a.isDelivery ? -1 : 1));
  }, [deliveries, points, names]);

  if (loaded && !batch) {
    return (
      <div className="space-y-4">
        <Link to="/batches" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Batches
        </Link>
        <p className="text-muted-foreground">Batch not found.</p>
      </div>
    );
  }
  if (!batch) return null;

  const stats: { label: string; value: string; warn?: boolean }[] = [
    { label: "Delivered (attached)", value: deliveredKg ? fmtKg(deliveredKg) : "—" },
    {
      label: "Drying loss",
      value:
        math.dryingLossPct !== null
          ? about(
              isEstimated(math, "received", "post_drying"),
              `${math.dryingLossPct}%${math.moistureBeforeDrying !== null && math.moistureAfterDrying !== null ? ` (${math.moistureBeforeDrying}% → ${math.moistureAfterDrying}%)` : ""}`,
            )
          : "—",
    },
    ...(math.moistureAfterPreDry !== null
      ? [{ label: "After flatbed pre-dry", value: `${math.moistureAfterPreDry}% moisture` }]
      : []),
    ...(math.inStoreKg !== null
      ? [{ label: "In store", value: about(isEstimated(math, "into_storage", "into_mill"), fmtKg(math.inStoreKg)) }]
      : []),
    {
      label: "Milling recovery",
      value: math.millingRecoveryPct !== null ? about(isEstimated(math, "into_mill", "milled_output"), `${math.millingRecoveryPct}%`) : "—",
    },
    { label: "Broken", value: math.brokenPct !== null ? `${math.brokenPct}%` : "—" },
    { label: "Bran / husk", value: math.branPct !== null || math.huskPct !== null ? `${math.branPct ?? "—"}% / ${math.huskPct ?? "—"}%` : "—" },
    {
      label: "Unaccounted after mill",
      value: math.unaccountedKg !== null ? fmtKg(math.unaccountedKg) : "—",
      warn: math.outputsExceedInput,
    },
  ];

  return (
    <>
    <div className="space-y-4 print:hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/batches" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold">{batch.batch_code}</h1>
              <Badge variant="outline">{custodyShort(batch.custody_model)}</Badge>
              <Badge className={batchStatusColors[batch.status] ?? ""} variant="outline">
                {batch.status}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              <span className="capitalize">{batch.crop_type}</span>
              {batch.variety ? ` · ${batch.variety}` : ""}
              {batch.dryer ? ` · dryer ${batch.dryer}` : ""} · created {batch.created_date}
              {batch.storage_location ? ` · ${batch.storage_location}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setLabelOpen(true)}>
            <QrCode className="h-4 w-4 mr-1" />
            Label
          </Button>
        <Select value={batch.status} onValueChange={setStatus}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BATCH_STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        </div>
      </div>

      {math.outputsExceedInput && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Recorded mill outputs weigh more than what went into the mill — check the weigh entries.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-sm font-semibold tabular-nums ${s.warn ? "text-destructive" : ""}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Timeline</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setAttachOpen(true)}>
              <Truck className="h-4 w-4 mr-1" />
              Attach delivery
            </Button>
            <Button size="sm" onClick={() => setWeighOpen(true)}>
              <Scale className="h-4 w-4 mr-1" />
              Add weigh point
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 && (
            <p className="text-sm text-muted-foreground py-4">
              Nothing yet. Attach deliveries as rice arrives, then add a weigh point at each stage — received, after
              drying, into the mill, and each mill output.
            </p>
          )}
          <ol className="space-y-0">
            {timeline.map((item, i) => (
              <li key={item.key} className="relative flex gap-3 pb-5 last:pb-0">
                {i < timeline.length - 1 && <span className="absolute left-[13px] top-7 bottom-0 w-px bg-border" />}
                <span
                  className={`h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold ${
                    item.isDelivery ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{item.title}</span>
                    {item.moisture !== null && (
                      <Badge variant="outline" className="font-normal">
                        {item.moisture}% moisture
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {item.date} · {item.who} · {item.detail}
                  </p>
                </div>
                {!item.isDelivery && item.point && canManage && (
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deletePoint(item.point!)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Stage totals</CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(totals).length === 0 ? (
            <p className="text-sm text-muted-foreground">No weigh points yet.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {STAGES.filter((s) => totals[s.value] !== undefined).map((s) => (
                  <Badge key={s.value} variant="secondary" className="font-normal tabular-nums">
                    {about(math.estimatedStages.includes(s.value), `${s.label}: ${fmtKg(totals[s.value])}`)}
                  </Badge>
                ))}
              </div>
              {math.estimatedStages.length > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  ≈ = estimated (bags × kg per bag), not weighed. Mill manager's note, 8 Sep 2026: jumbo bags are not weighed on the way into store.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Deliveries in this batch</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {deliveries.length === 0 && <p className="text-sm text-muted-foreground">None attached yet.</p>}
          {deliveries.map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-sm border-b last:border-b-0 py-1.5">
              <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="flex-1 min-w-0 truncate">
                {d.delivery_code} — {d.contracts?.farmers?.full_name ?? "?"}
                {d.variety ? ` · ${d.variety}` : ""} · {d.received_date}
              </span>
              <span className="tabular-nums text-muted-foreground">{fmtKg(d.gross_weight_kg)}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => detachDelivery(d)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={labelOpen} onOpenChange={setLabelOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Batch label</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            <BatchLabel
              batchCode={batch.batch_code}
              cropType={batch.crop_type}
              createdDate={batch.created_date}
              traceUrl={traceUrl}
            />
            <p className="text-xs text-muted-foreground break-all text-center">{traceUrl}</p>
            <Button className="w-full" onClick={() => window.print()}>
              Print label
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <WeighDialog
        open={weighOpen}
        onOpenChange={setWeighOpen}
        batchId={batchId}
        userId={user?.id ?? null}
        onDone={reload}
      />
      <AttachDeliveryDialog
        open={attachOpen}
        onOpenChange={setAttachOpen}
        batch={batch}
        attachedFarmerIds={deliveries.map((d) => d.contracts?.farmers?.id ?? "?")}
        onDone={reload}
      />
      {confirmDialog}
      </div>

      {/* Print target — the dialog itself lives in a portal, so printing is
          driven by this copy of the label instead (same house pattern as the
          contract/settlement print slips). */}
      <div className="hidden print:block">
        {labelOpen && (
          <BatchLabel
            batchCode={batch.batch_code}
            cropType={batch.crop_type}
            createdDate={batch.created_date}
            traceUrl={traceUrl}
          />
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Add weigh point                                                     */
/* ------------------------------------------------------------------ */

function WeighDialog({
  open,
  onOpenChange,
  batchId,
  userId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  batchId: string;
  userId: string | null;
  onDone: () => void;
}) {
  const [stage, setStage] = useState("received");
  const [weight, setWeight] = useState("");
  const [moisture, setMoisture] = useState("");
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  // Mill manager, 8 Sep 2026: jumbo bags into store are counted, not weighed. An
  // estimated point keeps the bag arithmetic so the ≈ can be explained later.
  const [estimated, setEstimated] = useState(false);
  const [bags, setBags] = useState("");
  const [kgPerBag, setKgPerBag] = useState(String(DEFAULT_KG_PER_BAG));

  useEffect(() => {
    if (open) {
      setStage("received");
      setWeight("");
      setMoisture("");
      setDate(today());
      setNotes("");
      setEstimated(false);
      setBags("");
      setKgPerBag(String(DEFAULT_KG_PER_BAG));
    }
  }, [open]);

  const onStage = (s: string) => {
    setStage(s);
    if (s === "into_storage") setEstimated(true);
  };

  const computedKg = estimated ? estimatedWeight(Number(bags) || 0, Number(kgPerBag) || 0) : Number(weight);

  const save = async () => {
    if (estimated) {
      if (computedKg <= 0) {
        toast.error("Bag count and kg per bag are required for an estimate.");
        return;
      }
    } else if (!weight || Number.isNaN(computedKg) || computedKg < 0) {
      toast.error("Weight (kg) is required.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("batch_weigh_points").insert({
      batch_id: batchId,
      stage,
      weight_kg: computedKg,
      estimated,
      bag_count: estimated ? Number(bags) : null,
      kg_per_bag: estimated ? Number(kgPerBag) : null,
      moisture_pct: moisture === "" ? null : Number(moisture),
      recorded_date: date,
      recorded_by: userId,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (!ok(error, "Add weigh point")) return;
    toast.success(`${stageLabel(stage)}: ${estimated ? "≈ " : ""}${computedKg.toLocaleString()} kg`);
    onOpenChange(false);
    onDone();
  };

  const moistureRelevant = (MOISTURE_STAGES as readonly string[]).includes(stage);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add weigh point</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Stage</Label>
            <Select value={stage} onValueChange={onStage}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 flex items-center gap-2 text-sm">
            <input
              id="wp-estimated"
              type="checkbox"
              checked={estimated}
              onChange={(e) => setEstimated(e.target.checked)}
              className="accent-[var(--primary)]"
            />
            <Label htmlFor="wp-estimated">Estimated, not weighed (bags × kg per bag)</Label>
          </div>
          {estimated ? (
            <>
              <div>
                <Label>Jumbo bags *</Label>
                <Input type="number" min="0" inputMode="numeric" value={bags} onChange={(e) => setBags(e.target.value)} />
              </div>
              <div>
                <Label>kg per bag</Label>
                <Input type="number" min="0" inputMode="decimal" value={kgPerBag} onChange={(e) => setKgPerBag(e.target.value)} />
                <p className="text-xs text-muted-foreground mt-1">
                  ≈ {computedKg.toLocaleString()} kg · bags hold 650–700 kg (mill manager, 8 Sep)
                </p>
              </div>
            </>
          ) : (
            <div>
              <Label>Weight (kg) *</Label>
              <Input type="number" min="0" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
            </div>
          )}
          <div>
            <Label>Moisture %{moistureRelevant ? "" : " (optional)"}</Label>
            <Input type="number" min="0" max="100" step="0.1" value={moisture} onChange={(e) => setMoisture(e.target.value)} />
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Add"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Attach delivery                                                     */
/* ------------------------------------------------------------------ */

function AttachDeliveryDialog({
  open,
  onOpenChange,
  batch,
  attachedFarmerIds,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  batch: Batch;
  attachedFarmerIds: string[];
  onDone: () => void;
}) {
  const [unbatched, setUnbatched] = useState<DeliveryWithFarmer[]>([]);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    supabase
      .from("deliveries")
      .select("*, contracts(id, contract_code, farmers(id, full_name))")
      .is("batch_id", null)
      .order("received_date", { ascending: false })
      .then(({ data, error }) => {
        ok(error, "Load unbatched deliveries");
        setUnbatched((data as unknown as DeliveryWithFarmer[]) ?? []);
      });
  }, [open]);

  const attach = async (d: DeliveryWithFarmer) => {
    if (varietyBlocks(batch.variety, d.variety)) {
      toast.error(`This batch is ${batch.variety}; ${d.delivery_code} is ${d.variety}. One dryer, one variety.`);
      return;
    }
    const farmerId = d.contracts?.farmers?.id;
    if (
      batch.custody_model === "identity_preserved" &&
      farmerId &&
      mixesFarmers([...attachedFarmerIds, farmerId])
    ) {
      toast.error(
        "This is a single-farmer (identity preserved) batch — it already holds another farmer's rice. Use a mixed batch instead.",
      );
      return;
    }
    setSaving(d.id);
    const { error } = await supabase.from("deliveries").update({ batch_id: batch.id }).eq("id", d.id);
    setSaving(null);
    if (!ok(error, "Attach delivery")) return;
    toast.success(`${d.delivery_code} attached`);
    setUnbatched((prev) => prev.filter((row) => row.id !== d.id));
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Attach delivery</DialogTitle>
        </DialogHeader>
        <div className="rounded-md border divide-y max-h-80 overflow-y-auto">
          {unbatched.length === 0 && (
            <p className="px-3 py-3 text-sm text-muted-foreground">No unbatched deliveries.</p>
          )}
          {unbatched.map((d) => (
            <div key={d.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="flex-1 min-w-0 truncate">
                {d.delivery_code} — {d.contracts?.farmers?.full_name ?? "?"}
                {d.variety ? ` · ${d.variety}` : ""} · {d.received_date}
              </span>
              <span className="tabular-nums text-muted-foreground">{d.gross_weight_kg.toLocaleString()} kg</span>
              <Button size="sm" variant="outline" disabled={saving === d.id} onClick={() => attach(d)}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
