import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { useConfirm } from "@/components/confirm";
import { humanize } from "@/lib/labels";
import type { Database } from "@/integrations/supabase/types";

type FieldVisit = Database["public"]["Tables"]["field_visits"]["Row"];
type FieldVisitInsert = Database["public"]["Tables"]["field_visits"]["Insert"];

export const Route = createFileRoute("/_authenticated/visits")({
  component: VisitsPage,
});

function VisitsPage() {
  const [visits, setVisits] = useState<(FieldVisit & { farmers?: { full_name: string } | null; farms?: { farm_name: string } | null })[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingVisit, setEditingVisit] = useState<FieldVisit | null>(null);
  const [form, setForm] = useState<Partial<FieldVisitInsert>>({});
  const { confirm, confirmDialog } = useConfirm();
  const [farmersList, setFarmersList] = useState<Array<{ id: string; full_name: string }>>([]);
  const [farmsList, setFarmsList] = useState<Array<{ id: string; farm_name: string; farmer_id: string }>>([]);
  const [search, setSearch] = useState("");

  const loadVisits = async () => {
    const { data, error } = await supabase.from("field_visits").select("*, farmers(full_name), farms(farm_name)").order("visit_date", { ascending: false }).limit(FETCH_LIMIT);
    ok(error, "Load visits");
    const page = capped(data);
    setVisits(page.rows);
    setTruncated(page.truncated);
  };

  useEffect(() => { loadVisits(); }, []);
  useEffect(() => {
    supabase.from("farmers").select("id, full_name").order("full_name").then(({ data }) => setFarmersList(data || []));
    supabase.from("farms").select("id, farm_name, farmer_id").order("farm_name").then(({ data }) => setFarmsList(data || []));
  }, []);

  const openNew = () => {
    setEditingVisit(null);
    setForm({ visit_type: "routine", visit_date: new Date().toISOString().split("T")[0] });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.farm_id || !form.farmer_id) {
      toast.error("Farmer and farm are required.");
      return;
    }
    if (editingVisit) {
      const { error } = await supabase.from("field_visits").update(form).eq("id", editingVisit.id);
      if (!ok(error, "Update visit")) return;
      toast.success("Visit updated");
    } else {
      const { error } = await supabase.from("field_visits").insert(form as FieldVisitInsert);
      if (!ok(error, "Create visit")) return;
      toast.success("Visit created");
    }
    setDialogOpen(false);
    loadVisits();
  };

  const handleDelete = async (id: string) => {
    const okToDelete = await confirm({
      title: "Delete this field visit?",
      description: "The visit record and its photos are removed. Cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!okToDelete) return;
    const { error } = await supabase.from("field_visits").delete().eq("id", id);
    if (!ok(error, "Delete visit")) return;
    toast.success("Visit deleted");
    loadVisits();
  };

  const filteredVisits = search
    ? visits.filter((v) => v.farmers?.full_name?.toLowerCase().includes(search.toLowerCase()) || v.farms?.farm_name?.toLowerCase().includes(search.toLowerCase()))
    : visits;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Field Visits</h1>
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" />Add Visit</Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by farmer or farm..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <RowCapNotice show={truncated} noun="visits" />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Farmer</TableHead>
                  <TableHead className="hidden md:table-cell">Farm</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="hidden md:table-cell">Crop Condition</TableHead>
                  <TableHead className="w-20 sticky right-0 bg-card shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.15)]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredVisits.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>{v.visit_date}</TableCell>
                    <TableCell>{v.farmers?.full_name || "—"}</TableCell>
                    <TableCell className="hidden md:table-cell">{v.farms?.farm_name || "—"}</TableCell>
                    <TableCell><Badge variant="secondary">{humanize(v.visit_type)}</Badge></TableCell>
                    <TableCell className="hidden md:table-cell">{v.crop_condition || "—"}</TableCell>
                    <TableCell className="sticky right-0 bg-card shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.15)]">
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" title="Edit visit" aria-label="Edit visit" onClick={() => { setEditingVisit(v); setForm(v); setDialogOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" title="Delete visit" aria-label="Delete visit" onClick={() => handleDelete(v.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredVisits.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">{search ? "No visits match this search." : "No field visits recorded yet."}</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingVisit ? "Edit Visit" : "Add Visit"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1">
              <Label>Farmer *</Label>
              <Select value={form.farmer_id || ""} onValueChange={(v) => setForm({ ...form, farmer_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select farmer" /></SelectTrigger>
                <SelectContent>{farmersList.map((f) => <SelectItem key={f.id} value={f.id}>{f.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Farm *</Label>
              <Select value={form.farm_id || ""} onValueChange={(v) => setForm({ ...form, farm_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select farm" /></SelectTrigger>
                <SelectContent>{farmsList.filter((f) => !form.farmer_id || f.farmer_id === form.farmer_id).map((f) => <SelectItem key={f.id} value={f.id}>{f.farm_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Visit Date</Label><Input type="date" value={form.visit_date || ""} onChange={(e) => setForm({ ...form, visit_date: e.target.value })} /></div>
              <div className="space-y-1">
                <Label>Visit Type</Label>
                <Select value={form.visit_type || "routine"} onValueChange={(v) => setForm({ ...form, visit_type: v as FieldVisit["visit_type"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["routine","follow_up","emergency","initial"].map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Crop Condition</Label><Input value={form.crop_condition || ""} onChange={(e) => setForm({ ...form, crop_condition: e.target.value })} /></div>
              <div className="space-y-1"><Label>Water Condition</Label><Input value={form.water_condition || ""} onChange={(e) => setForm({ ...form, water_condition: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={form.burn_signs_observed || false} onChange={(e) => setForm({ ...form, burn_signs_observed: e.target.checked })} />
                <Label>Burn Signs Observed</Label>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={form.pest_or_disease_observed || false} onChange={(e) => setForm({ ...form, pest_or_disease_observed: e.target.checked })} />
                <Label>Pest/Disease Observed</Label>
              </div>
            </div>
            <div className="space-y-1"><Label>Comments</Label><Input value={form.comments || ""} onChange={(e) => setForm({ ...form, comments: e.target.value })} /></div>
            <div className="space-y-1"><Label>Next Action</Label><Input value={form.next_action || ""} onChange={(e) => setForm({ ...form, next_action: e.target.value })} /></div>
            <div className="space-y-1"><Label>Next Visit Date</Label><Input type="date" value={form.next_visit_date || ""} onChange={(e) => setForm({ ...form, next_visit_date: e.target.value })} /></div>
            <Button onClick={handleSave}>{editingVisit ? "Update" : "Create"}</Button>
          </div>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </div>
  );
}
