// QC test dialog — list + add, either scoped to one delivery (deliveryId prop)
// or with its own delivery picker (deliveries.tsx contract-picker pattern).
// Shares its result-formatting/status-badge helpers with the /qc page so the
// dialog list and the page table read identically.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ok } from "@/lib/supabase-helpers";
import { useOffline } from "@/lib/offline";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2 } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { TEST_TYPES, qcTestTypeLabel } from "@/lib/labels";

// Re-exported so existing importers of the QC component keep working.
export { TEST_TYPES, qcTestTypeLabel } from "@/lib/labels";

export type QcTest = Database["public"]["Tables"]["qc_tests"]["Row"];
type QcTestInsert = Database["public"]["Tables"]["qc_tests"]["Insert"];
type Delivery = Database["public"]["Tables"]["deliveries"]["Row"];
type Contract = Database["public"]["Tables"]["contracts"]["Row"];

type DeliveryPickerRow = Pick<Delivery, "id" | "delivery_code"> & {
  contracts: (Pick<Contract, "contract_code"> & { farmers: { full_name: string } | null }) | null;
};

const today = () => new Date().toISOString().slice(0, 10);

/** Prefer the numeric result, fall back to the note, show both when present. */
export function qcResultLabel(row: Pick<QcTest, "result_value" | "result_text">): string {
  const hasValue = row.result_value !== null && row.result_value !== undefined;
  const hasText = !!row.result_text;
  if (hasValue && hasText) return `${row.result_value} — ${row.result_text}`;
  if (hasValue) return `${row.result_value}`;
  if (hasText) return row.result_text as string;
  return "—";
}

/** Pass / Fail / Pending badge, with an optional short hint shown after it. */
export function QcStatusBadge({ passed, hint }: { passed: boolean | null; hint?: string }) {
  let badge;
  if (passed === true) {
    badge = <Badge className="border-transparent bg-chart-2/15 text-chart-2 hover:bg-chart-2/15">Pass</Badge>;
  } else if (passed === false) {
    badge = <Badge variant="destructive">Fail</Badge>;
  } else {
    badge = <Badge variant="secondary">Pending</Badge>;
  }
  if (!hint) return badge;
  return (
    <>
      {badge}
      <span className="ml-1.5 text-xs text-muted-foreground">{hint}</span>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* QcDialog                                                            */
/* ------------------------------------------------------------------ */

export function QcDialog({
  open,
  onOpenChange,
  deliveryId,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Scope to one delivery. When absent, an in-dialog picker chooses the target. */
  deliveryId?: string;
  onChanged?: () => void;
}) {
  const { user, hasRole } = useAuth();
  const canDelete = hasRole("admin"); // only an admin deletes (roles-core.ts)
  const { confirm, confirmDialog } = useConfirm();

  const [pickerDeliveries, setPickerDeliveries] = useState<DeliveryPickerRow[]>([]);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState("");
  const [deliveryCode, setDeliveryCode] = useState<string | null>(null);
  const [tests, setTests] = useState<QcTest[]>([]);

  const [testType, setTestType] = useState("moisture");
  const [resultValue, setResultValue] = useState("");
  const [resultText, setResultText] = useState("");
  const [passedSel, setPassedSel] = useState<"pass" | "fail" | "pending">("pending");
  const [testedDate, setTestedDate] = useState(today());
  const [testedBy, setTestedBy] = useState("");
  const [method, setMethod] = useState("");
  const [saving, setSaving] = useState(false);
  const { save: saveRow } = useOffline();

  const targetId = deliveryId ?? (selectedDeliveryId || null);

  useEffect(() => {
    if (!open) return;
    setSelectedDeliveryId("");
    setTestType("moisture");
    setResultValue("");
    setResultText("");
    setPassedSel("pending");
    setTestedDate(today());
    setTestedBy("");
    setMethod("");
  }, [open]);

  // Delivery picker — only needed when the caller didn't already scope us to
  // one delivery. Newest 200; small enough that a plain Select is fine.
  useEffect(() => {
    if (!open || deliveryId) return;
    supabase
      .from("deliveries")
      .select("id, delivery_code, contracts(contract_code, farmers(full_name))")
      .order("received_date", { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        ok(error, "Load deliveries");
        setPickerDeliveries((data as unknown as DeliveryPickerRow[]) || []);
      });
  }, [open, deliveryId]);

  // Header label when we ARE scoped to one delivery.
  useEffect(() => {
    if (!open || !deliveryId) {
      setDeliveryCode(null);
      return;
    }
    supabase
      .from("deliveries")
      .select("delivery_code")
      .eq("id", deliveryId)
      .single()
      .then(({ data, error }) => {
        ok(error, "Load delivery");
        setDeliveryCode(data?.delivery_code ?? null);
      });
  }, [open, deliveryId]);

  const reload = useCallback(async () => {
    if (!targetId) {
      setTests([]);
      return;
    }
    const { data, error } = await supabase
      .from("qc_tests")
      .select("*")
      .eq("delivery_id", targetId)
      .order("tested_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (!ok(error, "Load QC tests")) return;
    setTests(data ?? []);
  }, [targetId]);

  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  const save = async () => {
    if (!targetId) {
      toast.error("Select a delivery.");
      return;
    }
    if (!testType) {
      toast.error("Select a test type.");
      return;
    }
    const rv = resultValue === "" ? null : Number(resultValue);
    const passed = passedSel === "pass" ? true : passedSel === "fail" ? false : null;
    if (rv === null && !resultText.trim() && passed === null) {
      toast.error("Record at least a value, note, or pass/fail.");
      return;
    }
    setSaving(true);
    const payload: QcTestInsert = {
      delivery_id: targetId,
      test_type: testType,
      result_value: rv,
      result_text: resultText.trim() || null,
      passed,
      tested_date: testedDate || today(),
      tested_by: testedBy.trim() || null,
      method: method.trim() || null,
      recorded_by: user?.id ?? null,
    };
    const { queued, error } = await saveRow("qc_tests", payload as unknown as Record<string, unknown>);
    setSaving(false);
    if (error) {
      toast.error(`Record QC test: ${error}`);
      return;
    }
    toast.success(queued ? "Test saved on this phone — will send when there is signal" : "QC test recorded");
    // Keep the dialog open (and, in picker mode, the chosen delivery) so a
    // string of tests for the same load can be logged back to back.
    setResultValue("");
    setResultText("");
    setPassedSel("pending");
    setTestedBy("");
    setMethod("");
    reload();
    onChanged?.();
  };

  const handleDelete = async (t: QcTest) => {
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
    reload();
    onChanged?.();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{deliveryId ? `QC tests — ${deliveryCode ?? "…"}` : "QC tests"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {!deliveryId && (
              <div>
                <Label>Delivery *</Label>
                <Select value={selectedDeliveryId} onValueChange={setSelectedDeliveryId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select delivery" />
                  </SelectTrigger>
                  <SelectContent>
                    {pickerDeliveries.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.delivery_code} — {d.contracts?.farmers?.full_name ?? "—"} ({d.contracts?.contract_code ?? "—"})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Test type *</Label>
                <Select value={testType} onValueChange={setTestType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEST_TYPES.map((tt) => (
                      <SelectItem key={tt.value} value={tt.value}>
                        {tt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Result</Label>
                <Select value={passedSel} onValueChange={(v) => setPassedSel(v as typeof passedSel)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pass">Pass</SelectItem>
                    <SelectItem value="fail">Fail</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Result value</Label>
                <Input type="number" value={resultValue} onChange={(e) => setResultValue(e.target.value)} />
              </div>
              <div>
                <Label>Result text</Label>
                <Input value={resultText} onChange={(e) => setResultText(e.target.value)} />
              </div>
              <div>
                <Label>Tested date</Label>
                <Input type="date" value={testedDate} onChange={(e) => setTestedDate(e.target.value)} />
              </div>
              <div>
                <Label>Tested by</Label>
                <Input value={testedBy} onChange={(e) => setTestedBy(e.target.value)} />
              </div>
              <div className="col-span-2">
                <Label>Method</Label>
                <Input
                  placeholder="e.g. lab strip test, GC-MS"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                />
              </div>
            </div>

            <Button onClick={save} disabled={saving || !targetId} className="w-full">
              {saving ? "Saving..." : "Add test"}
            </Button>

            <div className="border-t pt-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Tested by</TableHead>
                    {canDelete && <TableHead className="w-8" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tests.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>{qcTestTypeLabel(t.test_type)}</TableCell>
                      <TableCell>{qcResultLabel(t)}</TableCell>
                      <TableCell>
                        <QcStatusBadge passed={t.passed} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{t.tested_date}</TableCell>
                      <TableCell>{t.tested_by ?? "—"}</TableCell>
                      {canDelete && (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Delete this test"
                            aria-label="Delete this test"
                            onClick={() => handleDelete(t)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {tests.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={canDelete ? 6 : 5} className="text-center text-muted-foreground py-6 text-sm">
                        {targetId ? "No QC tests yet for this delivery." : "Select a delivery to see its QC tests."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </>
  );
}
