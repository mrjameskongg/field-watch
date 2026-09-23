import { createFileRoute, Link } from "@tanstack/react-router";
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
import { Plus, Search, Trash2, Pencil, Crosshair, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ok } from "@/lib/supabase-helpers";
import { capped, FETCH_LIMIT } from "@/lib/query-limits";
import { RowCapNotice } from "@/components/row-cap-notice";
import { BURN_ZONE, haversineKm } from "@/lib/firms-core";
import { useConfirm } from "@/components/confirm";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";

type Farm = Database["public"]["Tables"]["farms"]["Row"];
type FarmInsert = Database["public"]["Tables"]["farms"]["Insert"];

export const Route = createFileRoute("/_authenticated/farms")({
  component: FarmsPage,
  validateSearch: (s: Record<string, unknown>): { q?: string } => ({
    q: typeof s.q === "string" && s.q ? s.q : undefined,
  }),
});

function FarmsPage() {
  // Only an admin deletes; the database refuses anyone else (roles-core.ts).
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const { q } = Route.useSearch();
  const [farms, setFarms] = useState<(Farm & { farmers?: { full_name: string } | null })[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [search, setSearch] = useState(q ?? "");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingFarm, setEditingFarm] = useState<Farm | null>(null);
  const [form, setForm] = useState<Partial<FarmInsert>>({});
  const { confirm, confirmDialog } = useConfirm();
  const [locating, setLocating] = useState(false);
  const [farmersList, setFarmersList] = useState<Array<{ id: string; full_name: string; farmer_code: string }>>([]);

  const loadFarms = async () => {
    let q = supabase.from("farms").select("*, farmers(full_name)").order("created_at", { ascending: false }).limit(FETCH_LIMIT);
    if (statusFilter !== "all") q = q.eq("status", statusFilter as Farm["status"]);
    if (search) {
      q = q.or(`farm_code.ilike.%${sanitizeSearch(search)}%,farm_name.ilike.%${sanitizeSearch(search)}%,province.ilike.%${sanitizeSearch(search)}%`);
    }
    const { data, error } = await q;
    ok(error, "Load farms");
    const page = capped(data);
    setFarms(page.rows);
    setTruncated(page.truncated);
  };

  useEffect(() => { loadFarms(); }, [search, statusFilter]);

  // The header's global search lands here as ?q=; keep the box in sync.
  useEffect(() => { if (q != null) setSearch(q); }, [q]);

  useEffect(() => {
    supabase.from("farmers").select("id, full_name, farmer_code").order("full_name").then(({ data }) => setFarmersList(data || []));
  }, []);

  const openNew = () => {
    setEditingFarm(null);
    setForm({ farm_code: `FRM-F-${String(Date.now()).slice(-6)}`, status: "active", risk_level: "low", crop_type: "rice" });
    setDialogOpen(true);
  };

  const openEdit = (f: Farm) => { setEditingFarm(f); setForm(f); setDialogOpen(true); };

  const handleSave = async () => {
    if (!form.farm_name || !form.farmer_id) {
      toast.error("Farm name and farmer are required.");
      return;
    }
    if (editingFarm) {
      const { error } = await supabase.from("farms").update(form).eq("id", editingFarm.id);
      if (!ok(error, "Update farm")) return;
      toast.success("Farm updated");
    } else {
      const { error } = await supabase.from("farms").insert(form as FarmInsert);
      if (!ok(error, "Create farm")) return;
      toast.success("Farm created");
    }
    setDialogOpen(false);
    loadFarms();
  };

  const captureLocation = () => {
    if (!("geolocation" in navigator)) {
      toast.error("This device/browser cannot read GPS. Type the coordinates instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude, longitude, accuracy } = pos.coords;
        setForm((prev) => ({
          ...prev,
          latitude: Number(latitude.toFixed(6)),
          longitude: Number(longitude.toFixed(6)),
        }));
        const km = haversineKm(latitude, longitude, BURN_ZONE.latitude, BURN_ZONE.longitude);
        if (km > BURN_ZONE.radiusKm) {
          toast.warning(`Saved, but this point is ${km.toFixed(1)} km from the BRM estate — outside the burn-watch zone.`);
        } else {
          toast.success(`GPS captured (±${Math.round(accuracy)} m, ${km.toFixed(2)} km from estate centre).`);
        }
      },
      (err) => {
        setLocating(false);
        const reason =
          err.code === err.PERMISSION_DENIED
            ? "Location permission was blocked. Allow location for this site, then try again."
            : err.code === err.POSITION_UNAVAILABLE
              ? "No GPS fix. Step outside, wait a moment, then try again."
              : "GPS timed out. Try again.";
        toast.error(reason);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  };

  const handleDelete = async (id: string, name: string) => {
    const okToDelete = await confirm({
      title: `Delete ${name}?`,
      description: "This also deletes its field visits and photos. Cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!okToDelete) return;
    const { error } = await supabase.from("farms").delete().eq("id", id);
    if (!ok(error, "Delete farm")) return;
    toast.success("Farm deleted");
    loadFarms();
  };

  const riskColors: Record<string, string> = {
    low: "bg-chart-2/10 text-chart-2",
    medium: "bg-chart-4/10 text-chart-4",
    high: "bg-chart-1/10 text-chart-1",
    critical: "bg-destructive/10 text-destructive",
  };

  const gpsHint = (() => {
    if (form.latitude == null || form.longitude == null) {
      return "Stand in the parcel and tap \u201cUse my location\u201d, or type coordinates from a phone map.";
    }
    const km = haversineKm(form.latitude, form.longitude, BURN_ZONE.latitude, BURN_ZONE.longitude);
    return km > BURN_ZONE.radiusKm
      ? `\u26a0 ${km.toFixed(1)} km from the BRM estate centre \u2014 outside the ${BURN_ZONE.radiusKm} km burn-watch zone, fires here will not be matched to this parcel.`
      : `\u2713 ${km.toFixed(2)} km from the BRM estate centre \u2014 inside the burn-watch zone.`;
  })();

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Farms</h1>
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" />Add Farm</Button>
      </div>

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
                <SelectItem value="fallow">Fallow</SelectItem>
                <SelectItem value="harvested">Harvested</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <RowCapNotice show={truncated} noun="farms" />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Farmer</TableHead>
                  <TableHead className="hidden md:table-cell">Area (ha)</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead className="w-20 sticky right-0 bg-card shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.15)]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {farms.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell>
                      <Link to="/farms/$farmId" params={{ farmId: f.id }} className="text-primary hover:underline font-medium">{f.farm_code}</Link>
                    </TableCell>
                    <TableCell>{f.farm_name}</TableCell>
                    <TableCell className="hidden md:table-cell">{f.farmers?.full_name || "—"}</TableCell>
                    <TableCell className="hidden md:table-cell">{f.area_hectares || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={riskColors[f.risk_level || "low"]}>{f.risk_level}</Badge>
                    </TableCell>
                    <TableCell className="sticky right-0 bg-card shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.15)]">
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(f)}><Pencil className="h-3.5 w-3.5" /></Button>
                        {isAdmin && (
                        <Button size="icon" variant="ghost" onClick={() => handleDelete(f.id, f.farm_name)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {farms.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">{search || statusFilter !== "all" ? "No parcels match this search." : "No parcels yet \u2014 add a farmer first, then add their parcel and capture its GPS on site."}</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingFarm ? "Edit Farm" : "Add Farm"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Farm Code</Label><Input value={form.farm_code || ""} onChange={(e) => setForm({ ...form, farm_code: e.target.value })} /></div>
              <div className="space-y-1"><Label>Farm Name *</Label><Input value={form.farm_name || ""} onChange={(e) => setForm({ ...form, farm_name: e.target.value })} /></div>
            </div>
            <div className="space-y-1">
              <Label>Farmer *</Label>
              <Select value={form.farmer_id || ""} onValueChange={(v) => setForm({ ...form, farmer_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select farmer" /></SelectTrigger>
                <SelectContent>
                  {farmersList.map((f) => <SelectItem key={f.id} value={f.id}>{f.full_name} ({f.farmer_code})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Province</Label><Input value={form.province || ""} onChange={(e) => setForm({ ...form, province: e.target.value })} /></div>
              <div className="space-y-1"><Label>District</Label><Input value={form.district || ""} onChange={(e) => setForm({ ...form, district: e.target.value })} /></div>
            </div>
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm font-medium">GPS location</Label>
                <Button type="button" size="sm" variant="secondary" onClick={captureLocation} disabled={locating}>
                  {locating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Crosshair className="h-4 w-4 mr-1" />}
                  {locating ? "Getting GPS..." : "Use my location"}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs text-muted-foreground">Latitude</Label><Input type="number" value={form.latitude ?? ""} onChange={(e) => setForm({ ...form, latitude: parseFloat(e.target.value) || undefined })} /></div>
                <div className="space-y-1"><Label className="text-xs text-muted-foreground">Longitude</Label><Input type="number" value={form.longitude ?? ""} onChange={(e) => setForm({ ...form, longitude: parseFloat(e.target.value) || undefined })} /></div>
              </div>
              <p className="text-xs text-muted-foreground">{gpsHint}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Area (ha)</Label><Input type="number" value={form.area_hectares || ""} onChange={(e) => setForm({ ...form, area_hectares: parseFloat(e.target.value) || undefined })} /></div>
              <div className="space-y-1">
                <Label>Crop Type</Label>
                <Select value={form.crop_type || "rice"} onValueChange={(v) => setForm({ ...form, crop_type: v as Farm["crop_type"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["rice","cassava","corn","sugarcane","rubber","pepper","vegetable","fruit","other"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Risk Level</Label>
                <Select value={form.risk_level || "low"} onValueChange={(v) => setForm({ ...form, risk_level: v as Farm["risk_level"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["low","medium","high","critical"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={form.status || "active"} onValueChange={(v) => setForm({ ...form, status: v as Farm["status"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["active","inactive","fallow","harvested"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={handleSave}>{editingFarm ? "Update" : "Create"}</Button>
          </div>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </div>
  );
}
