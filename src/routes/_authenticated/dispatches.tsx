// Dispatches: append-only outbound movements (buyer + product + kg).
// No edit path by design — a wrong dispatch is deleted (admin/manager) or
// reversed, never amended. Stock on /stock derives from these rows.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ok } from "@/lib/supabase-helpers";
import { capped, FETCH_LIMIT } from "@/lib/query-limits";
import { RowCapNotice } from "@/components/row-cap-notice";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { DISPATCH_PRODUCTS, nextDispatchCode, validateDispatch, type DispatchProduct } from "@/lib/dispatch-core";
import { stockSnapshot } from "@/lib/stock-core";
import { useI18n, type I18nKey } from "@/lib/i18n";

type Dispatch = Database["public"]["Tables"]["dispatches"]["Row"];
type Buyer = Database["public"]["Tables"]["buyers"]["Row"];

export const Route = createFileRoute("/_authenticated/dispatches")({
  component: DispatchesPage,
});

const today = () => new Date().toISOString().slice(0, 10);

const productKey: Record<DispatchProduct, I18nKey> = {
  milled_output: "stock.headRice",
  broken: "stock.broken",
  bran: "stock.bran",
  husk: "stock.husk",
};

function DispatchesPage() {
  const { t } = useI18n();
  const { hasRole, user } = useAuth();
  const canDelete = hasRole("admin"); // only an admin deletes (roles-core.ts)
  const { confirm, confirmDialog } = useConfirm();

  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [onHand, setOnHand] = useState<Record<DispatchProduct, number>>({
    milled_output: 0,
    broken: 0,
    bran: 0,
    husk: 0,
  });
  const [truncated, setTruncated] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [buyerId, setBuyerId] = useState("");
  const [newBuyerName, setNewBuyerName] = useState("");
  const [product, setProduct] = useState<DispatchProduct>("milled_output");
  const [weight, setWeight] = useState("");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(today());

  const load = async () => {
    const [dRes, bRes, delivRes, batchRes, weighRes] = await Promise.all([
      supabase.from("dispatches").select("*").order("dispatched_date", { ascending: false }).order("created_at", { ascending: false }).limit(FETCH_LIMIT),
      supabase.from("buyers").select("*").order("name").limit(FETCH_LIMIT),
      supabase.from("deliveries").select("id, gross_weight_kg, batch_id").limit(1000),
      supabase.from("batches").select("id, batch_code, status, crop_type, variety, created_date").limit(1000),
      supabase.from("batch_weigh_points").select("batch_id, stage, weight_kg, moisture_pct").limit(1000),
    ]);
    const failed = [dRes, bRes, delivRes, batchRes, weighRes].find((r) => r.error);
    if (failed) {
      ok(failed.error, "Load dispatches");
      return;
    }
    const page = capped(dRes.data);
    setDispatches(page.rows);
    setTruncated(page.truncated);
    setBuyers(bRes.data ?? []);
    const snap = stockSnapshot(delivRes.data ?? [], batchRes.data ?? [], weighRes.data ?? [], page.rows);
    setOnHand({
      milled_output: snap.onHand.headRiceKg,
      broken: snap.onHand.brokenKg,
      bran: snap.onHand.branKg,
      husk: snap.onHand.huskKg,
    });
  };

  useEffect(() => {
    load();
  }, []);

  const buyerName = (id: string) => buyers.find((b) => b.id === id)?.name ?? "—";

  const openNew = () => {
    setBuyerId("");
    setNewBuyerName("");
    setProduct("milled_output");
    setWeight("");
    setPrice("");
    setDate(today());
    setDialogOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      let finalBuyerId = buyerId;
      if (buyerId === "__new") {
        const name = newBuyerName.trim();
        if (!name) {
          toast.error(t("dispatch.errBuyer"));
          return;
        }
        const { data, error } = await supabase.from("buyers").insert({ name }).select("id").single();
        if (!ok(error, "Create buyer") || !data) return;
        finalBuyerId = data.id;
      }
      const draft = {
        buyerId: finalBuyerId,
        product,
        weightKg: Number(weight),
        pricePerKg: price === "" ? null : Number(price),
      };
      const err = validateDispatch(draft, onHand[product]);
      if (err) {
        toast.error(t(err as I18nKey));
        return;
      }
      const code = nextDispatchCode(dispatches.map((d) => d.dispatch_code), new Date().getFullYear());
      const { error } = await supabase.from("dispatches").insert({
        dispatch_code: code,
        buyer_id: finalBuyerId,
        product: draft.product,
        weight_kg: draft.weightKg,
        price_per_kg: draft.pricePerKg,
        dispatched_date: date,
        recorded_by: user?.id ?? null,
      });
      if (!ok(error, "Create dispatch")) return;
      toast.success(`${code} — ${t("dispatch.created")}`);
      setDialogOpen(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (d: Dispatch) => {
    const confirmed = await confirm({
      title: `${t("dispatch.deleteTitle")} ${d.dispatch_code}?`,
      description: t("dispatch.deleteBody"),
      confirmLabel: t("dispatch.deleteConfirm"),
      destructive: true,
    });
    if (!confirmed) return;
    const { error } = await supabase.from("dispatches").delete().eq("id", d.id);
    if (!ok(error, "Delete dispatch")) return;
    toast.success(t("dispatch.deleted"));
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("dispatch.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("dispatch.subtitle")} <Link to="/stock" className="text-primary hover:underline">{t("nav.stock")}</Link>
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-1" />
          {t("dispatch.new")}
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
            <RowCapNotice show={truncated} noun="dispatches" />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("dispatch.colCode")}</TableHead>
                  <TableHead>{t("dispatch.colDate")}</TableHead>
                  <TableHead>{t("dispatch.colBuyer")}</TableHead>
                  <TableHead>{t("dispatch.colProduct")}</TableHead>
                  <TableHead className="text-right">{t("dispatch.colWeight")}</TableHead>
                  <TableHead className="text-right">{t("dispatch.colPrice")}</TableHead>
                  {canDelete && <TableHead className="sticky right-0 bg-card">{t("dispatch.colActions")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {dispatches.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canDelete ? 7 : 6} className="text-center text-muted-foreground py-8">
                      {t("dispatch.empty")}
                    </TableCell>
                  </TableRow>
                )}
                {dispatches.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.dispatch_code}</TableCell>
                    <TableCell>{d.dispatched_date}</TableCell>
                    <TableCell>{buyerName(d.buyer_id)}</TableCell>
                    <TableCell>{t(productKey[d.product as DispatchProduct] ?? "stock.headRice")}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.weight_kg.toLocaleString("en-US")} kg</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {d.price_per_kg === null ? "—" : `$${d.price_per_kg}/kg`}
                    </TableCell>
                    {canDelete && (
                      <TableCell className="sticky right-0 bg-card">
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(d)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dispatch.new")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("dispatch.colBuyer")}</Label>
              <Select value={buyerId} onValueChange={setBuyerId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("dispatch.pickBuyer")} />
                </SelectTrigger>
                <SelectContent>
                  {buyers.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="__new">{t("dispatch.newBuyer")}</SelectItem>
                </SelectContent>
              </Select>
              {buyerId === "__new" && (
                <Input
                  placeholder={t("dispatch.newBuyerName")}
                  value={newBuyerName}
                  onChange={(e) => setNewBuyerName(e.target.value)}
                />
              )}
            </div>
            <div className="space-y-2">
              <Label>{t("dispatch.colProduct")}</Label>
              <Select value={product} onValueChange={(v) => setProduct(v as DispatchProduct)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISPATCH_PRODUCTS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {t(productKey[p])} — {onHand[p].toLocaleString("en-US")} kg
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("dispatch.colWeight")}</Label>
                <Input type="number" min="0" value={weight} onChange={(e) => setWeight(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{t("dispatch.priceOptional")}</Label>
                <Input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("dispatch.colDate")}</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                {t("dispatch.cancel")}
              </Button>
              <Button onClick={save} disabled={saving}>
                {t("dispatch.save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </div>
  );
}
