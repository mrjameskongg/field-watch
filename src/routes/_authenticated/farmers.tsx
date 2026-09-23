import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeSearch } from "@/lib/search-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { ok } from "@/lib/supabase-helpers";
import { capped, FETCH_LIMIT } from "@/lib/query-limits";
import { RowCapNotice } from "@/components/row-cap-notice";
import { useConfirm } from "@/components/confirm";
import { DocDots } from "@/components/farmer-file";
import { StageGuide } from "@/components/stage-guide";
import { farmerDocs, type DocStatus } from "@/lib/farmer-file-core";
import { useI18n } from "@/lib/i18n";
import { farmerStatusLabel } from "@/lib/labels";
import type { GuideCounts } from "@/lib/onboarding-core";
import type { Database } from "@/integrations/supabase/types";

type Farmer = Database["public"]["Tables"]["farmers"]["Row"];
type FarmerInsert = Database["public"]["Tables"]["farmers"]["Insert"];

export const Route = createFileRoute("/_authenticated/farmers")({
  component: FarmersPage,
});

const statusColors: Record<string, string> = {
  active: "bg-chart-2/10 text-chart-2",
  inactive: "bg-muted text-muted-foreground",
  suspended: "bg-destructive/10 text-destructive",
};

function FarmersPage() {
  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingFarmer, setEditingFarmer] = useState<Farmer | null>(null);
  const [form, setForm] = useState<Partial<FarmerInsert>>({});
  const { confirm, confirmDialog } = useConfirm();
  const { t } = useI18n();
  const [docsByFarmer, setDocsByFarmer] = useState<Map<string, DocStatus[]> | null>(null);
  const [guideCounts, setGuideCounts] = useState<GuideCounts | null>(null);

  // One scoped query per table for the WHOLE visible page of farmers.
  // .in() lists stay small while the operation is small; past ~1000 rows in
  // any of these tables the dots should move into a DB view (like the v_*
  // report views) instead of client math.
  const loadDocs = async (rows: Farmer[]) => {
    if (rows.length === 0) return setDocsByFarmer(new Map());
    const ids = rows.map((r) => r.id);
    const [farmsRes, contractsRes, alertsRes] = await Promise.all([
      supabase.from("farms").select("farmer_id, latitude, boundary_geojson").in("farmer_id", ids).limit(1000),
      supabase.from("contracts").select("id, farmer_id, status, expected_yield_kg").in("farmer_id", ids).limit(1000),
      supabase
        .from("alerts")
        .select("farmer_id")
        .eq("alert_type", "possible_burn")
        .in("status", ["new", "investigating"])
        .in("farmer_id", ids)
        .limit(1000),
    ]);
    const contractIds = (contractsRes.data ?? []).map((c) => c.id);
    const [advancesRes, deliveriesRes] = await Promise.all([
      contractIds.length
        ? supabase.from("input_advances").select("contract_id").in("contract_id", contractIds).limit(1000)
        : Promise.resolve({ data: [], error: null }),
      contractIds.length
        ? supabase.from("deliveries").select("id, contract_id, gross_weight_kg").in("contract_id", contractIds).limit(1000)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const deliveryIds = (deliveriesRes.data ?? []).map((d) => d.id);
    const qcRes = deliveryIds.length
      ? await supabase.from("qc_tests").select("delivery_id").eq("test_type", "moisture").in("delivery_id", deliveryIds).limit(1000)
      : { data: [], error: null };

    // A failed query must never render as "this farmer has nothing" — show
    // no dots at all instead.
    const results = [farmsRes, contractsRes, alertsRes, advancesRes, deliveriesRes, qcRes];
    if (results.some((r) => r.error)) {
      ok(results.find((r) => r.error)!.error, "Load document status");
      return setDocsByFarmer(null);
    }

    const contractFarmer = new Map((contractsRes.data ?? []).map((c) => [c.id, c.farmer_id]));
    const deliveryFarmer = new Map(
      (deliveriesRes.data ?? []).map((d) => [d.id, contractFarmer.get(d.contract_id)]),
    );
    const tested = new Map<string, Set<string>>();
    for (const q of qcRes.data ?? []) {
      if (!q.delivery_id) continue;
      const fid = deliveryFarmer.get(q.delivery_id);
      if (!fid) continue;
      if (!tested.has(fid)) tested.set(fid, new Set());
      tested.get(fid)!.add(q.delivery_id);
    }

    const map = new Map<string, DocStatus[]>();
    for (const f of rows) {
      const farms = (farmsRes.data ?? []).filter((x) => x.farmer_id === f.id);
      map.set(
        f.id,
        farmerDocs({
          phone: f.phone_number,
          mappedFarms: farms.filter((x) => x.latitude !== null || x.boundary_geojson !== null).length,
          totalFarms: farms.length,
          contracts: (contractsRes.data ?? []).filter((c) => c.farmer_id === f.id),
          advanceCount: (advancesRes.data ?? []).filter((a) => contractFarmer.get(a.contract_id) === f.id).length,
          deliveries: (deliveriesRes.data ?? []).filter((d) => contractFarmer.get(d.contract_id) === f.id),
          moistureTestedDeliveryIds: tested.get(f.id) ?? new Set(),
          activeBurnAlerts: (alertsRes.data ?? []).filter((a) => a.farmer_id === f.id).length,
        }),
      );
    }
    setDocsByFarmer(map);
  };

  const loadFarmers = async () => {
    let q = supabase.from("farmers").select("*").order("created_at", { ascending: false }).limit(FETCH_LIMIT);
    if (statusFilter !== "all") q = q.eq("status", statusFilter as Farmer["status"]);
    if (search) {
      q = q.or(`full_name.ilike.%${sanitizeSearch(search)}%,farmer_code.ilike.%${sanitizeSearch(search)}%,phone_number.ilike.%${sanitizeSearch(search)}%,province.ilike.%${sanitizeSearch(search)}%`);
    }
    const { data, error } = await q;
    ok(error, "Load farmers");
    const page = capped(data);
    setFarmers(page.rows);
    setTruncated(page.truncated);
    loadDocs(page.rows);
  };

  useEffect(() => { loadFarmers(); }, [search, statusFilter]);

  // Same guide the dashboard used to carry — the guide lives on the home
  // screen, and the home screen is now this list.
  useEffect(() => {
    async function loadGuide() {
      const [farmersRes, mappedFarmsRes, contractsRes, advancesRes, deliveriesRes, moistureRes, settlementsRes, batchesRes, shippedRes] =
        await Promise.all([
          supabase.from("farmers").select("id", { count: "exact", head: true }),
          supabase.from("farms").select("id", { count: "exact", head: true }).or("latitude.not.is.null,boundary_geojson.not.is.null"),
          supabase.from("contracts").select("id", { count: "exact", head: true }),
          supabase.from("input_advances").select("id", { count: "exact", head: true }),
          supabase.from("deliveries").select("id", { count: "exact", head: true }),
          supabase.from("qc_tests").select("id", { count: "exact", head: true }).eq("test_type", "moisture"),
          supabase.from("settlements").select("id", { count: "exact", head: true }),
          supabase.from("batches").select("id", { count: "exact", head: true }),
          supabase.from("batches").select("id", { count: "exact", head: true }).in("status", ["shipped", "closed"]),
        ]);
      const all = [farmersRes, mappedFarmsRes, contractsRes, advancesRes, deliveriesRes, moistureRes, settlementsRes, batchesRes, shippedRes];
      // A failed count must never silently look like zero and steer the guide wrong.
      if (all.every((r) => !r.error)) {
        setGuideCounts({
          farmers: farmersRes.count ?? 0,
          farmsWithGps: mappedFarmsRes.count ?? 0,
          contracts: contractsRes.count ?? 0,
          inputAdvances: advancesRes.count ?? 0,
          deliveries: deliveriesRes.count ?? 0,
          moistureTests: moistureRes.count ?? 0,
          settlements: settlementsRes.count ?? 0,
          batches: batchesRes.count ?? 0,
          shippedBatches: shippedRes.count ?? 0,
        });
      }
    }
    loadGuide();
  }, []);

  const generateCode = () => `FRM-${String(Date.now()).slice(-6)}`;

  const openNew = () => {
    setEditingFarmer(null);
    setForm({ farmer_code: generateCode(), status: "active", contract_status: "pending", crop_type: "rice" });
    setDialogOpen(true);
  };

  const openEdit = (f: Farmer) => {
    setEditingFarmer(f);
    setForm(f);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.full_name || !form.farmer_code) {
      toast.error("Farmer code and full name are required.");
      return;
    }
    if (editingFarmer) {
      const { error } = await supabase.from("farmers").update(form).eq("id", editingFarmer.id);
      if (!ok(error, "Update farmer")) return;
      toast.success("Farmer updated");
    } else {
      const { error } = await supabase.from("farmers").insert(form as FarmerInsert);
      if (!ok(error, "Create farmer")) return;
      toast.success("Farmer created");
    }
    setDialogOpen(false);
    loadFarmers();
  };

  const handleDelete = async (id: string, name: string) => {
    const okToDelete = await confirm({
      title: `Delete ${name}?`,
      description: "This also deletes their farms, field visits, photos, contracts, deliveries, advances and settlements (financial ledger). Cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!okToDelete) return;
    const { error } = await supabase.from("farmers").delete().eq("id", id);
    if (!ok(error, "Delete farmer")) return;
    toast.success("Farmer deleted");
    loadFarmers();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Farmers</h1>
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" />Add Farmer</Button>
      </div>

      {guideCounts && <StageGuide counts={guideCounts} />}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <RowCapNotice show={truncated} noun="farmers" />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Phone</TableHead>
                  <TableHead className="hidden md:table-cell">Province</TableHead>
                  <TableHead>{t("ff.docs")}</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20 sticky right-0 bg-card shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.15)]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {farmers.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell>
                      <Link to="/farmers/$farmerId" params={{ farmerId: f.id }} className="text-primary hover:underline font-medium">
                        {f.farmer_code}
                      </Link>
                    </TableCell>
                    <TableCell>{f.full_name}</TableCell>
                    <TableCell className="hidden md:table-cell">{f.phone_number}</TableCell>
                    <TableCell className="hidden md:table-cell">{f.province}</TableCell>
                    <TableCell>
                      {docsByFarmer?.has(f.id) ? <DocDots docs={docsByFarmer.get(f.id)!} /> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={statusColors[f.status] || ""}>
                        {farmerStatusLabel(f.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="sticky right-0 bg-card shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.15)]">
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" title="Edit farmer" aria-label="Edit farmer" onClick={() => openEdit(f)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" title="Delete farmer" aria-label="Delete farmer" onClick={() => handleDelete(f.id, f.full_name)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {farmers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">{search || statusFilter !== "all" ? "No farmers match this search." : "No farmers yet \u2014 use \u201cAdd Farmer\u201d above to add the first one."}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingFarmer ? "Edit Farmer" : "Add Farmer"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Farmer Code</Label>
                <Input value={form.farmer_code || ""} onChange={(e) => setForm({ ...form, farmer_code: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Full Name *</Label>
                <Input value={form.full_name || ""} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Gender</Label>
                <Select value={form.gender || ""} onValueChange={(v) => setForm({ ...form, gender: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Phone</Label>
                <Input value={form.phone_number || ""} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Province</Label>
                <Input value={form.province || ""} onChange={(e) => setForm({ ...form, province: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>District</Label>
                <Input value={form.district || ""} onChange={(e) => setForm({ ...form, district: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Commune</Label>
                <Input value={form.commune || ""} onChange={(e) => setForm({ ...form, commune: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Village</Label>
                <Input value={form.village || ""} onChange={(e) => setForm({ ...form, village: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={form.status || "active"} onValueChange={(v) => setForm({ ...form, status: v as Farmer["status"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Crop Type</Label>
                <Select value={form.crop_type || "rice"} onValueChange={(v) => setForm({ ...form, crop_type: v as Farmer["crop_type"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["rice","cassava","corn","sugarcane","rubber","pepper","vegetable","fruit","other"].map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Input value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Certifications</Label>
              <Input placeholder="organic, fair trade..." value={form.certifications || ""} onChange={(e) => setForm({ ...form, certifications: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Labor Notes</Label>
              <Input value={form.labor_notes || ""} onChange={(e) => setForm({ ...form, labor_notes: e.target.value })} />
            </div>
            <Button onClick={handleSave}>{editingFarmer ? "Update" : "Create"}</Button>
          </div>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </div>
  );
}
