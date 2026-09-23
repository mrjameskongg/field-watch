import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeSearch } from "@/lib/search-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ok } from "@/lib/supabase-helpers";
import { capped, FETCH_LIMIT } from "@/lib/query-limits";
import { RowCapNotice } from "@/components/row-cap-notice";
import { genCode } from "@/lib/trade-core";
import { BATCH_STATUSES, CUSTODY_MODELS, DEFAULT_CUSTODY } from "@/lib/batch-core";
import { useAuth } from "@/lib/auth";
import { useConfirm } from "@/components/confirm";
import type { Database } from "@/integrations/supabase/types";

type Batch = Database["public"]["Tables"]["batches"]["Row"];
type BatchInsert = Database["public"]["Tables"]["batches"]["Insert"];
type BatchListRow = Batch & { deliveries: { count: number }[] };

export const Route = createFileRoute("/_authenticated/batches")({
  component: BatchesPage,
});

export const batchStatusColors: Record<string, string> = {
  open: "bg-chart-2/10 text-chart-2",
  drying: "bg-chart-4/10 text-chart-4",
  milling: "bg-chart-4/10 text-chart-4",
  stored: "bg-primary/10 text-primary",
  shipped: "bg-muted text-muted-foreground",
  closed: "bg-muted text-muted-foreground",
};

export const custodyShort = (model: string) => (model === "mass_balance" ? "Mixed" : "Single farmer");

function BatchesPage() {
  const { hasRole } = useAuth();
  const canDelete = hasRole("admin"); // only an admin deletes (roles-core.ts)
  const [batches, setBatches] = useState<BatchListRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<Partial<BatchInsert>>({});
  const { confirm, confirmDialog } = useConfirm();

  const load = async () => {
    let q = supabase
      .from("batches")
      .select("*, deliveries(count)")
      .order("created_at", { ascending: false })
      .limit(FETCH_LIMIT);
    if (statusFilter !== "all") q = q.eq("status", statusFilter);
    if (search)
      q = q.or(
        `batch_code.ilike.%${sanitizeSearch(search)}%,storage_location.ilike.%${sanitizeSearch(search)}%,variety.ilike.%${sanitizeSearch(search)}%`,
      );
    const { data, error } = await q;
    ok(error, "Load batches");
    const page = capped((data as unknown as BatchListRow[]) || []);
    setBatches(page.rows);
    setTruncated(page.truncated);
  };

  useEffect(() => {
    load();
  }, [search, statusFilter]);

  // Datalist for the variety field: whatever the mill has already typed.
  const varieties = useMemo(
    () => [...new Set(batches.map((b) => b.variety).filter((v): v is string => !!v))].sort(),
    [batches],
  );

  const openNew = () => {
    setForm({
      batch_code: genCode("B26"),
      crop_type: "rice",
      custody_model: DEFAULT_CUSTODY,
      status: "open",
      variety: null,
      dryer: null,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.batch_code) {
      toast.error("Batch code is required.");
      return;
    }
    const { error } = await supabase.from("batches").insert(form as BatchInsert);
    if (!ok(error, "Create batch")) return;
    toast.success("Batch created");
    setDialogOpen(false);
    load();
  };

  const handleDelete = async (b: Batch) => {
    const okToDelete = await confirm({
      title: `Delete ${b.batch_code}?`,
      description: "Weigh points are deleted; attached deliveries are released back to unbatched. Cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!okToDelete) return;
    const { error } = await supabase.from("batches").delete().eq("id", b.id);
    if (!ok(error, "Delete batch")) return;
    toast.success("Batch deleted");
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Batches</h1>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-1" />
          New Batch
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search code, storage..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {BATCH_STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <RowCapNotice show={truncated} noun="batches" />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Crop</TableHead>
                  <TableHead>Variety</TableHead>
                  <TableHead>Custody</TableHead>
                  <TableHead>Deliveries</TableHead>
                  <TableHead>Storage</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="sticky right-0 bg-card">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <Link
                        to="/batches/$batchId"
                        params={{ batchId: b.id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {b.batch_code}
                      </Link>
                    </TableCell>
                    <TableCell className="capitalize">{b.crop_type}</TableCell>
                    <TableCell>{b.variety ?? "—"}</TableCell>
                    <TableCell>{custodyShort(b.custody_model)}</TableCell>
                    <TableCell>{b.deliveries?.[0]?.count ?? 0}</TableCell>
                    <TableCell>{b.storage_location ?? "—"}</TableCell>
                    <TableCell>{b.created_date}</TableCell>
                    <TableCell>
                      <Badge className={batchStatusColors[b.status] ?? ""} variant="outline">
                        {b.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="sticky right-0 bg-card">
                      {canDelete && (
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(b)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {batches.length === 0 && (
            <p className="text-center text-muted-foreground py-8">
              No batches yet. Create one, then attach deliveries as rice arrives at the warehouse.
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Batch</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Batch code *</Label>
              <Input value={form.batch_code ?? ""} onChange={(e) => setForm({ ...form, batch_code: e.target.value })} />
            </div>
            <div>
              <Label>Crop</Label>
              <Input value={form.crop_type ?? ""} onChange={(e) => setForm({ ...form, crop_type: e.target.value })} />
            </div>
            <div>
              <Label>Variety</Label>
              <Input
                list="batch-varieties"
                placeholder="e.g. Sen Kra Ob"
                value={form.variety ?? ""}
                onChange={(e) => setForm({ ...form, variety: e.target.value || null })}
              />
              <datalist id="batch-varieties">
                {varieties.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground mt-1">
                One dryer, one variety. Deliveries of another variety cannot be attached.
              </p>
            </div>
            <div>
              <Label>Dryer</Label>
              <Input
                placeholder="e.g. Vertical 1, Flatbed A"
                value={form.dryer ?? ""}
                onChange={(e) => setForm({ ...form, dryer: e.target.value || null })}
              />
            </div>
            <div className="col-span-2">
              <Label>Custody</Label>
              <Select
                value={form.custody_model ?? DEFAULT_CUSTODY}
                onValueChange={(v) => setForm({ ...form, custody_model: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CUSTODY_MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {CUSTODY_MODELS.find((m) => m.value === (form.custody_model ?? DEFAULT_CUSTODY))?.hint}
              </p>
            </div>
            <div className="col-span-2">
              <Label>Storage location</Label>
              <Input
                value={form.storage_location ?? ""}
                onChange={(e) => setForm({ ...form, storage_location: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Input value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Create</Button>
          </div>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </div>
  );
}
