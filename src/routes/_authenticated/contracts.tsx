import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { Plus, Search, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { ok } from "@/lib/supabase-helpers";
import { capped, FETCH_LIMIT } from "@/lib/query-limits";
import { RowCapNotice } from "@/components/row-cap-notice";
import { genCode } from "@/lib/trade-core";
import { contractDisplayStatus } from "@/lib/contract-core";
import { asCurrency, fmtMoney } from "@/lib/money-core";
import { useConfirm } from "@/components/confirm";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";

type Contract = Database["public"]["Tables"]["contracts"]["Row"];
type ContractInsert = Database["public"]["Tables"]["contracts"]["Insert"];
type FarmerLite = { id: string; full_name: string; farmer_code: string; village: string | null };

export const Route = createFileRoute("/_authenticated/contracts")({
  // ?new=1&farmer=<id> — the Farmer File's "New contract" button opens the
  // dialog prefilled with that farmer. Cleared right after opening so
  // refresh doesn't re-open it.
  validateSearch: (s: Record<string, unknown>) => ({
    new: s.new === 1 || s.new === "1" ? (1 as const) : undefined,
    farmer: typeof s.farmer === "string" ? s.farmer : undefined,
  }),
  component: ContractsPage,
});

const statusColors: Record<string, string> = {
  active: "bg-chart-2/10 text-chart-2",
  season_closed: "border-amber-500/50 text-amber-600",
  completed: "bg-muted text-muted-foreground",
  cancelled: "bg-destructive/10 text-destructive",
};

function ContractsPage() {
  // Only an admin deletes; the database refuses anyone else (roles-core.ts).
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const [contracts, setContracts] = useState<(Contract & { farmers: FarmerLite | null })[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [farmers, setFarmers] = useState<FarmerLite[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [form, setForm] = useState<Partial<ContractInsert>>({});
  const { confirm, confirmDialog } = useConfirm();

  const load = async () => {
    let q = supabase
      .from("contracts")
      .select("*, farmers(id, full_name, farmer_code, village)")
      .order("created_at", { ascending: false })
      .limit(FETCH_LIMIT);
    if (statusFilter !== "all") q = q.eq("status", statusFilter);
    if (search) q = q.or(`contract_code.ilike.%${sanitizeSearch(search)}%,season_label.ilike.%${sanitizeSearch(search)}%,crop_type.ilike.%${sanitizeSearch(search)}%`);
    const { data, error } = await q;
    ok(error, "Load contracts");
    const page = capped((data as unknown as (Contract & { farmers: FarmerLite | null })[]) || []);
    setContracts(page.rows);
    setTruncated(page.truncated);
  };

  useEffect(() => { load(); }, [search, statusFilter]);
  useEffect(() => {
    supabase.from("farmers").select("id, full_name, farmer_code, village").order("full_name")
      .then(({ data, error }) => { ok(error, "Load farmers"); setFarmers(data || []); });
  }, []);

  const openNew = (farmerId?: string) => {
    setEditing(null);
    setForm({
      contract_code: genCode("CT"), crop_type: "rice", grower_type: "outgrower",
      price_mode: "market", status: "active", currency: "USD",
      farmer_id: farmerId,
      season_label: new Date().getMonth() >= 4 && new Date().getMonth() <= 9
        ? `Wet ${new Date().getFullYear()}` : `Dry ${new Date().getFullYear()}`,
    });
    setDialogOpen(true);
  };

  const routeSearch = Route.useSearch();
  const navigate = useNavigate();
  useEffect(() => {
    if (routeSearch.new) {
      openNew(routeSearch.farmer);
      navigate({ to: "/contracts", search: { new: undefined, farmer: undefined }, replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSearch.new]);
  const openEdit = (c: Contract & { farmers: FarmerLite | null }) => {
    // Rows carry a joined `farmers` object from the list select; PostgREST
    // rejects unknown columns in an UPDATE body, so it must never enter form
    // state (or it gets spread straight into .update() in handleSave).
    const { farmers: _farmers, ...row } = c;
    setEditing(c);
    setForm(row);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.farmer_id || !form.season_label || !form.contract_code) {
      toast.error("Farmer, season and contract code are required."); return;
    }
    if (form.price_mode === "fixed" && !form.fixed_price_per_kg) {
      toast.error("Fixed-price contracts need a price per kg."); return;
    }
    if (editing) {
      const { error } = await supabase.from("contracts")
        .update({ ...form, updated_at: new Date().toISOString() }).eq("id", editing.id);
      if (!ok(error, "Update contract")) return;
      toast.success("Contract updated");
    } else {
      const { error } = await supabase.from("contracts").insert(form as ContractInsert);
      if (!ok(error, "Create contract")) return;
      toast.success("Contract created");
    }
    setDialogOpen(false); load();
  };

  const handleDelete = async (c: Contract) => {
    const okToDelete = await confirm({
      title: `Delete ${c.contract_code}?`,
      description: "This deletes its advances, deliveries and settlements. Cannot be undone.",
      confirmLabel: "Delete", destructive: true,
    });
    if (!okToDelete) return;
    const { error } = await supabase.from("contracts").delete().eq("id", c.id);
    if (!ok(error, "Delete contract")) return;
    toast.success("Contract deleted"); load();
  };

  const num = (v: string) => (v === "" ? null : Number(v));

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Contracts</h1>
        <Button onClick={() => openNew()}><Plus className="h-4 w-4 mr-1" />Add Contract</Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search code, season, crop..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <RowCapNotice show={truncated} noun="contracts" />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Farmer</TableHead>
                  <TableHead>Season</TableHead>
                  <TableHead>Crop</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Hectares</TableHead>
                  <TableHead>Expected kg</TableHead>
                  <TableHead>Pricing</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="sticky right-0 bg-card">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.length === 0 && (
                  <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                    No contracts yet. Add one, or import Angie's purchase documents.
                  </TableCell></TableRow>
                )}
                {contracts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell><Link to="/contracts/$contractId" params={{ contractId: c.id }} className="font-medium text-primary hover:underline">{c.contract_code}</Link></TableCell>
                    <TableCell>{c.farmers ? `${c.farmers.full_name} (${c.farmers.farmer_code})` : "—"}</TableCell>
                    <TableCell>{c.season_label}</TableCell>
                    <TableCell className="capitalize">{c.crop_type}</TableCell>
                    <TableCell className="capitalize">{c.grower_type}</TableCell>
                    <TableCell>{c.contracted_hectares ?? "—"}</TableCell>
                    <TableCell>{c.expected_yield_kg ? c.expected_yield_kg.toLocaleString() : "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {c.price_mode === "fixed" ? `Fixed ${fmtMoney(c.fixed_price_per_kg, asCurrency(c.currency))}/kg` : `Market · ${asCurrency(c.currency)}`}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const st = contractDisplayStatus(c);
                        return <Badge className={statusColors[st.key] ?? ""} variant="outline">{st.label}</Badge>;
                      })()}
                    </TableCell>
                    <TableCell className="sticky right-0 bg-card">
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(c)} title="Edit contract" aria-label="Edit contract"><Pencil className="h-4 w-4" /></Button>
                        {isAdmin && (
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(c)} title="Delete contract" aria-label="Delete contract"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Contract" : "New Contract"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Farmer *</Label>
              <Select value={form.farmer_id ?? ""} onValueChange={(v) => setForm({ ...form, farmer_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select farmer" /></SelectTrigger>
                <SelectContent>
                  {farmers.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.full_name} — {f.farmer_code}{f.village ? ` (${f.village})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Contract code *</Label><Input value={form.contract_code ?? ""} onChange={(e) => setForm({ ...form, contract_code: e.target.value })} /></div>
            <div><Label>Season *</Label><Input value={form.season_label ?? ""} onChange={(e) => setForm({ ...form, season_label: e.target.value })} /></div>
            <div><Label>Crop</Label><Input value={form.crop_type ?? ""} onChange={(e) => setForm({ ...form, crop_type: e.target.value })} /></div>
            <div>
              <Label>Grower type</Label>
              <Select value={form.grower_type ?? "outgrower"} onValueChange={(v) => setForm({ ...form, grower_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="outgrower">Outgrower</SelectItem>
                  <SelectItem value="ingrower">Ingrower</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Hectares</Label><Input type="number" value={form.contracted_hectares ?? ""} onChange={(e) => setForm({ ...form, contracted_hectares: num(e.target.value) })} /></div>
            <div><Label>Expected yield (kg)</Label><Input type="number" value={form.expected_yield_kg ?? ""} onChange={(e) => setForm({ ...form, expected_yield_kg: num(e.target.value) })} /></div>
            <div>
              <Label>Currency</Label>
              <Select value={form.currency ?? "USD"} onValueChange={(v) => setForm({ ...form, currency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD · dollars</SelectItem>
                  <SelectItem value="KHR">KHR · riel ៛</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Price mode</Label>
              <Select value={form.price_mode ?? "market"} onValueChange={(v) => setForm({ ...form, price_mode: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="market">Market price</SelectItem>
                  <SelectItem value="fixed">Fixed price</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.price_mode === "fixed" && (
              <div><Label>Fixed price ({form.currency ?? "USD"}/kg) *</Label><Input type="number" step="0.001" value={form.fixed_price_per_kg ?? ""} onChange={(e) => setForm({ ...form, fixed_price_per_kg: num(e.target.value) })} /></div>
            )}
            <div><Label>Signed date</Label><Input type="date" value={form.signed_date ?? ""} onChange={(e) => setForm({ ...form, signed_date: e.target.value })} /></div>
            {editing && (
              <div>
                <Label>Status</Label>
                <Select value={form.status ?? "active"} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="col-span-2"><Label>Notes</Label><Input value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editing ? "Save" : "Create"}</Button>
          </div>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </div>
  );
}
