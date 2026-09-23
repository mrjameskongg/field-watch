// Market prices admin: list + dialog. Smallest instance of the
// list/dialog skeleton (mirrors contracts.tsx), trimmed to one table.

import { createFileRoute } from "@tanstack/react-router";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Pencil } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type MarketPrice = Database["public"]["Tables"]["market_prices"]["Row"];
type MarketPriceInsert = Database["public"]["Tables"]["market_prices"]["Insert"];

export const Route = createFileRoute("/_authenticated/prices")({
  component: PricesPage,
});

const today = () => new Date().toISOString().slice(0, 10);

function PricesPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const canManage = hasRole("admin") || hasRole("manager");
  const { confirm, confirmDialog } = useConfirm();

  const [prices, setPrices] = useState<MarketPrice[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MarketPrice | null>(null);
  const [form, setForm] = useState<Partial<MarketPriceInsert>>({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("market_prices")
      .select("*")
      .order("price_date", { ascending: false })
      .limit(FETCH_LIMIT);
    ok(error, "Load prices");
    const page = capped(data);
    setPrices(page.rows);
    setTruncated(page.truncated);
  };

  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ price_date: today(), crop_type: "rice" });
    setDialogOpen(true);
  };
  const openEdit = (p: MarketPrice) => {
    setEditing(p);
    setForm(p);
    setDialogOpen(true);
  };

  const num = (v: string) => (v === "" ? null : Number(v));

  const save = async () => {
    if (!form.price_date || !form.crop_type) {
      toast.error("Date and crop are required.");
      return;
    }
    if (!form.price_per_kg || form.price_per_kg <= 0) {
      toast.error("Price per kg must be greater than zero.");
      return;
    }
    setSaving(true);
    if (editing) {
      const { error } = await supabase.from("market_prices").update(form).eq("id", editing.id);
      setSaving(false);
      if (!ok(error, "Update price")) return;
      toast.success("Price updated");
    } else {
      const { error } = await supabase.from("market_prices").insert(form as MarketPriceInsert);
      setSaving(false);
      if (!ok(error, "Create price")) return;
      toast.success("Price added");
    }
    setDialogOpen(false);
    load();
  };

  const handleDelete = async (p: MarketPrice) => {
    const confirmed = await confirm({
      title: `Delete ${p.crop_type} price for ${p.price_date}?`,
      description: "This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    const { error } = await supabase.from("market_prices").delete().eq("id", p.id);
    if (!ok(error, "Delete price")) return;
    toast.success("Price deleted");
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Market Prices</h1>
          <p className="text-sm text-muted-foreground">
            Used to autofill delivery prices for market-price contracts.
          </p>
        </div>
        {canManage && (
          <Button onClick={openNew}>
            <Plus className="h-4 w-4 mr-1" />
            Add Price
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
            <RowCapNotice show={truncated} noun="market prices" />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Crop</TableHead>
                  <TableHead>$ per kg</TableHead>
                  <TableHead>Source</TableHead>
                  {canManage && <TableHead className="sticky right-0 bg-card">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {prices.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canManage ? 5 : 4} className="text-center text-muted-foreground py-8">
                      No prices yet. Add one to enable delivery price autofill.
                    </TableCell>
                  </TableRow>
                )}
                {prices.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.price_date}</TableCell>
                    <TableCell className="capitalize">{p.crop_type}</TableCell>
                    <TableCell>${p.price_per_kg}/kg</TableCell>
                    <TableCell>{p.source ?? "—"}</TableCell>
                    {canManage && (
                      <TableCell className="sticky right-0 bg-card">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {isAdmin && (
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(p)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                          )}
                        </div>
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Price" : "New Price"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Date *</Label>
              <Input
                type="date"
                value={form.price_date ?? ""}
                onChange={(e) => setForm({ ...form, price_date: e.target.value })}
              />
            </div>
            <div>
              <Label>Crop *</Label>
              <Input
                value={form.crop_type ?? ""}
                onChange={(e) => setForm({ ...form, crop_type: e.target.value })}
              />
            </div>
            <div>
              <Label>Price ($/kg) *</Label>
              <Input
                type="number"
                step="0.001"
                value={form.price_per_kg ?? ""}
                onChange={(e) => setForm({ ...form, price_per_kg: num(e.target.value) ?? undefined })}
              />
            </div>
            <div>
              <Label>Source</Label>
              <Input
                value={form.source ?? ""}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving..." : editing ? "Save" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </div>
  );
}
