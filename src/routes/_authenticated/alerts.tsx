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
import { Plus, Search, Satellite, Loader2, Trash2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { ok } from "@/lib/supabase-helpers";
import { capped, FETCH_LIMIT } from "@/lib/query-limits";
import { RowCapNotice } from "@/components/row-cap-notice";
import { useConfirm } from "@/components/confirm";
import { runBurnScan } from "@/lib/burn-scan";
import { alertStatusLabel, alertTypeLabel, humanize } from "@/lib/labels";
import type { Database } from "@/integrations/supabase/types";

type Alert = Database["public"]["Tables"]["alerts"]["Row"];
type AlertInsert = Database["public"]["Tables"]["alerts"]["Insert"];

export const Route = createFileRoute("/_authenticated/alerts")({
  component: AlertsPage,
});

const severityColors: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-chart-4/10 text-chart-4",
  high: "bg-chart-1/10 text-chart-1",
  critical: "bg-destructive/10 text-destructive",
};

const statusColors: Record<string, string> = {
  new: "bg-chart-1/10 text-chart-1",
  investigating: "bg-chart-4/10 text-chart-4",
  resolved: "bg-chart-2/10 text-chart-2",
  dismissed: "bg-muted text-muted-foreground",
};

function AlertsPage() {
  const [alerts, setAlerts] = useState<(Alert & { farmers?: { full_name: string } | null; farms?: { farm_name: string } | null })[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<Partial<AlertInsert>>({});
  const [farmersList, setFarmersList] = useState<Array<{ id: string; full_name: string }>>([]);
  const [farmsList, setFarmsList] = useState<Array<{ id: string; farm_name: string }>>([]);
  const [scanning, setScanning] = useState(false);
  const { confirm, confirmDialog } = useConfirm();

  const loadAlerts = async () => {
    let q = supabase.from("alerts").select("*, farmers(full_name), farms(farm_name)").order("created_at", { ascending: false }).limit(FETCH_LIMIT);
    if (statusFilter !== "all") q = q.eq("status", statusFilter as Alert["status"]);
    if (typeFilter !== "all") q = q.eq("alert_type", typeFilter as Alert["alert_type"]);
    const { data, error } = await q;
    ok(error, "Load alerts");
    const page = capped(data);
    setAlerts(page.rows);
    setTruncated(page.truncated);
  };

  useEffect(() => { loadAlerts(); }, [statusFilter, typeFilter]);
  useEffect(() => {
    supabase.from("farmers").select("id, full_name").then(({ data }) => setFarmersList(data || []));
    supabase.from("farms").select("id, farm_name").then(({ data }) => setFarmsList(data || []));
  }, []);

  const handleResolve = async (id: string) => {
    const { error } = await supabase.from("alerts").update({ status: "resolved", resolved_date: new Date().toISOString() }).eq("id", id);
    if (!ok(error, "Resolve alert")) return;
    toast.success("Alert resolved");
    loadAlerts();
  };

  const handleDismiss = async (id: string) => {
    const { error } = await supabase.from("alerts").update({ status: "dismissed" }).eq("id", id);
    if (!ok(error, "Dismiss alert")) return;
    loadAlerts();
  };

  const handleDelete = async (id: string, label: string) => {
    const okToDelete = await confirm({
      title: `Delete this ${label} alert?`,
      description: "Removes the alert record for good. Resolve or Dismiss instead if you want to keep the history.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!okToDelete) return;
    const { error } = await supabase.from("alerts").delete().eq("id", id);
    if (!ok(error, "Delete alert")) return;
    toast.success("Alert deleted");
    loadAlerts();
  };

  const handleSave = async () => {
    if (!form.alert_type) return;
    const { error } = await supabase.from("alerts").insert(form as AlertInsert);
    if (!ok(error, "Create alert")) return;
    toast.success("Alert created");
    setDialogOpen(false);
    loadAlerts();
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      const result = await runBurnScan();
      if (result.error) {
        toast.error(`Burn scan failed: ${result.error}`);
        return;
      }
      const gpsNote = result.farmsWithoutGps > 0 ? ` ${result.farmsWithoutGps} parcel(s) have no GPS.` : "";
      if (result.newAlerts > 0) {
        toast.warning(`${result.hotspots} hotspot(s) in BRM zone — ${result.newAlerts} new alert(s).${gpsNote}`);
      } else {
        toast.success(`No fires: ${result.hotspots} hotspot(s) in BRM zone, nothing new.${gpsNote}`);
      }
      loadAlerts();
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Alerts</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleScan} disabled={scanning}>
            {scanning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Satellite className="h-4 w-4 mr-1" />}
            Scan for burns
          </Button>
          <Button onClick={() => { setForm({ alert_type: "manual_flag", severity: "medium", source: "manual", status: "new" }); setDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" />Create Alert
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {["new","investigating","resolved","dismissed"].map((s) => <SelectItem key={s} value={s}>{alertStatusLabel(s)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {["water_stress","possible_burn","low_vegetation","manual_flag"].map((t) => <SelectItem key={t} value={t}>{alertTypeLabel(t)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <RowCapNotice show={truncated} noun="alerts" />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Farm</TableHead>
                  <TableHead className="hidden md:table-cell">Farmer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-24 sticky right-0 bg-card shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.15)]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{alertTypeLabel(a.alert_type)}</TableCell>
                    <TableCell><Badge variant="secondary" className={severityColors[a.severity]}>{humanize(a.severity)}</Badge></TableCell>
                    <TableCell><Badge variant="secondary" className={statusColors[a.status]}>{alertStatusLabel(a.status)}</Badge></TableCell>
                    <TableCell className="hidden md:table-cell">{a.farms?.farm_name || "—"}</TableCell>
                    <TableCell className="hidden md:table-cell">{a.farmers?.full_name || "—"}</TableCell>
                    <TableCell>{new Date(a.detected_date).toLocaleDateString()}</TableCell>
                    <TableCell className="sticky right-0 bg-card shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.15)]">
                      <div className="flex gap-1 items-center">
                        {(a.status === "new" || a.status === "investigating") && (
                          <>
                            <Button size="sm" variant="outline" title="Resolve" aria-label="Resolve alert" onClick={() => handleResolve(a.id)}>
                              <Check className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Resolve</span>
                            </Button>
                            <Button size="sm" variant="ghost" title="Dismiss" aria-label="Dismiss alert" onClick={() => handleDismiss(a.id)}>
                              <X className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Dismiss</span>
                            </Button>
                          </>
                        )}
                        <Button size="icon" variant="ghost" title="Delete alert" aria-label="Delete alert" onClick={() => handleDelete(a.id, alertTypeLabel(a.alert_type))}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {alerts.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">{statusFilter !== "all" || typeFilter !== "all" ? "No alerts match this filter." : "No alerts \u2014 the burn watch has not flagged anything."}</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Alert</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Alert Type</Label>
                <Select value={form.alert_type || "manual_flag"} onValueChange={(v) => setForm({ ...form, alert_type: v as Alert["alert_type"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["water_stress","possible_burn","low_vegetation","manual_flag"].map((t) => <SelectItem key={t} value={t}>{alertTypeLabel(t)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Severity</Label>
                <Select value={form.severity || "medium"} onValueChange={(v) => setForm({ ...form, severity: v as Alert["severity"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["low","medium","high","critical"].map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Farm</Label>
              <Select value={form.farm_id || ""} onValueChange={(v) => setForm({ ...form, farm_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{farmsList.map((f) => <SelectItem key={f.id} value={f.id}>{f.farm_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Farmer</Label>
              <Select value={form.farmer_id || ""} onValueChange={(v) => setForm({ ...form, farmer_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{farmersList.map((f) => <SelectItem key={f.id} value={f.id}>{f.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Description</Label><Input value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="space-y-1"><Label>Recommended Action</Label><Input value={form.recommended_action || ""} onChange={(e) => setForm({ ...form, recommended_action: e.target.value })} /></div>
            <Button onClick={handleSave}>Create Alert</Button>
          </div>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </div>
  );
}
