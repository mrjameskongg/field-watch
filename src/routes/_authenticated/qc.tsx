// Quality page: every QC test across every delivery, filterable, with the
// same add dialog used per-row on /deliveries (Task 3 wires that row action).

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ok } from "@/lib/supabase-helpers";
import { capped, FETCH_LIMIT } from "@/lib/query-limits";
import { RowCapNotice } from "@/components/row-cap-notice";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { QcDialog, qcResultLabel, qcTestTypeLabel, QcStatusBadge, type QcTest } from "@/components/qc";

type Delivery = Database["public"]["Tables"]["deliveries"]["Row"];
type Contract = Database["public"]["Tables"]["contracts"]["Row"];
type FarmerLite = { full_name: string };
type QcTestWithDelivery = QcTest & {
  deliveries: (Pick<Delivery, "delivery_code"> & {
    contracts: (Pick<Contract, "contract_code"> & { farmers: FarmerLite | null }) | null;
  }) | null;
};

type Filter = "all" | "pesticide_residue" | "moisture" | "other" | "failed";

export const Route = createFileRoute("/_authenticated/qc")({
  component: QcPage,
});

function QcPage() {
  const { hasRole } = useAuth();
  const canDelete = hasRole("admin"); // only an admin deletes (roles-core.ts)
  const { confirm, confirmDialog } = useConfirm();

  const [tests, setTests] = useState<QcTestWithDelivery[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("qc_tests")
      .select("*, deliveries(delivery_code, contracts(contract_code, farmers(full_name)))")
      .order("tested_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(FETCH_LIMIT);
    ok(error, "Load QC tests");
    // qc_tests carries a typed FK to deliveries, but deliveries itself has no
    // Relationships metadata, so the nested contracts/farmers hop still needs
    // the house `as unknown as` cast.
    const page = capped((data as unknown as QcTestWithDelivery[]) || []);
    setTests(page.rows);
    setTruncated(page.truncated);
  };

  useEffect(() => {
    load();
  }, []);

  const visible = useMemo(() => {
    if (filter === "failed") return tests.filter((t) => t.passed === false);
    if (filter === "all") return tests;
    return tests.filter((t) => t.test_type === filter);
  }, [tests, filter]);

  const handleDelete = async (t: QcTestWithDelivery) => {
    const confirmed = await confirm({
      title: `Delete this ${qcTestTypeLabel(t.test_type)} test?`,
      description: "This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    const { error } = await supabase.from("qc_tests").delete().eq("id", t.id);
    if (!ok(error, "Delete QC test")) return;
    toast.success("QC test deleted");
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Quality</h1>
          <p className="text-sm text-muted-foreground">
            Formal QC records — moisture retests and the pesticide-residue protocol. Receipt moisture lives on the
            delivery itself.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Add test
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pesticide_residue">Pesticide residue</SelectItem>
              <SelectItem value="moisture">Moisture</SelectItem>
              <SelectItem value="other">Other</SelectItem>
              <SelectItem value="failed">Failed only</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <RowCapNotice show={truncated} noun="QC tests" />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead>Farmer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tested by</TableHead>
                  <TableHead className="sticky right-0 bg-card">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="whitespace-nowrap">{t.tested_date}</TableCell>
                    <TableCell className="font-medium">{t.deliveries?.delivery_code ?? "—"}</TableCell>
                    <TableCell>{t.deliveries?.contracts?.farmers?.full_name ?? "—"}</TableCell>
                    <TableCell>{qcTestTypeLabel(t.test_type)}</TableCell>
                    <TableCell>{qcResultLabel(t)}</TableCell>
                    <TableCell>
                      <QcStatusBadge
                        passed={t.passed}
                        hint={t.test_type === "moisture" && t.passed === false ? "Dry, then retest" : undefined}
                      />
                    </TableCell>
                    <TableCell>{t.tested_by ?? "—"}</TableCell>
                    <TableCell className="sticky right-0 bg-card">
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Delete test"
                          aria-label="Delete test"
                          onClick={() => handleDelete(t)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {visible.length === 0 && <p className="text-center text-muted-foreground py-8">No QC tests yet.</p>}
        </CardContent>
      </Card>

      <QcDialog open={dialogOpen} onOpenChange={setDialogOpen} onChanged={load} />
      {confirmDialog}
    </div>
  );
}
