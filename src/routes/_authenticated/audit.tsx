// Audit log: every insert, update and delete on the business tables, with who
// made it and what the record was before. Written by a database trigger, so
// no screen can skip it; readable by admins only, editable by nobody.

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ok } from "@/lib/supabase-helpers";
import { actorLabel, describeChanges, isCorrection, recordName, tableLabel, TABLE_LABELS, type AuditEntry } from "@/lib/audit-core";
import { LOCKED_COLUMNS } from "@/lib/roles-core";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/audit")({
  component: AuditPage,
});

const LIMIT = 200;

const ACTION_STYLE: Record<string, string> = {
  insert: "bg-primary/10 text-primary",
  update: "bg-chart-4/10 text-chart-4",
  delete: "bg-destructive/10 text-destructive",
};

function AuditPage() {
  const { viewRoles, isDemo } = useAuth();
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [table, setTable] = useState("all");
  const [action, setAction] = useState("all");
  const isAdmin = viewRoles.includes("admin");

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("audit_log")
      .select("id, at, actor_email, actor_roles, table_name, row_id, row_label, action, changes")
      .order("at", { ascending: false })
      .limit(LIMIT);
    if (table !== "all") q = q.eq("table_name", table);
    if (action !== "all") q = q.eq("action", action);
    const { data, error } = await q;
    setLoading(false);
    if (!ok(error, "Load audit log")) return;
    setRows((data ?? []) as AuditEntry[]);
  }, [table, action]);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  if (!isAdmin) {
    return (
      <div className="text-muted-foreground">
        The audit log is for admins only.
        {isDemo && " In the demo, switch View as to Admin in the header."}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Every change to farmers, farms, contracts, money, weights and tests: who made it, when, and what it was before.
          A database trigger writes it, so no screen can skip it, and nobody can edit or delete it, admins included.
        </p>
        {isDemo && (
          <p className="mt-1 text-sm text-muted-foreground">The demo shows entries for its synthetic farmers only.</p>
        )}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <Select value={table} onValueChange={setTable}>
            <SelectTrigger className="h-8 w-44 text-sm" aria-label="Filter by record type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All records</SelectItem>
              {Object.entries(TABLE_LABELS).map(([k, label]) => (
                <SelectItem key={k} value={k}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="h-8 w-36 text-sm" aria-label="Filter by action">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              <SelectItem value="insert">Added</SelectItem>
              <SelectItem value="update">Changed</SelectItem>
              <SelectItem value="delete">Deleted</SelectItem>
            </SelectContent>
          </Select>
          <span className="ml-auto text-xs text-muted-foreground">
            {loading ? "Loading..." : `${rows.length}${rows.length === LIMIT ? "+" : ""} entries, newest first`}
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Record</TableHead>
                <TableHead className="w-24">Action</TableHead>
                <TableHead>What changed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No changes recorded yet. The log started on 23 September 2026.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="num whitespace-nowrap text-xs">{new Date(r.at).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{actorLabel(r)}</TableCell>
                  <TableCell className="text-xs">
                    <span className="text-muted-foreground">{tableLabel(r.table_name)}</span> {recordName(r)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={ACTION_STYLE[r.action] ?? ""}>
                      {r.action === "insert" ? "Added" : r.action === "delete" ? "Deleted" : "Changed"}
                    </Badge>
                    {isCorrection(r, LOCKED_COLUMNS) && (
                      <Badge variant="outline" className="ml-1 border-amber-500 text-amber-600" title="A posted fact was corrected; only an admin can do this">
                        Correction
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {describeChanges(r).map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
