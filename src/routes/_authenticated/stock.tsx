// Stock on hand — read-only, derived entirely from weighed movements
// (deliveries + batch weigh points). No stock table, no double entry: the
// numbers here cannot drift from the scale. Dispatch/sales don't exist yet,
// so outputs are on hand by definition (stated on the page).

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ok } from "@/lib/supabase-helpers";
import { millNext, stockSnapshot, type StockSnapshot } from "@/lib/stock-core";
import { openOnly } from "@/lib/season-core";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/stock")({
  component: StockPage,
});

const kg = (n: number) => `${n.toLocaleString("en-US")} kg`;

function StockPage() {
  const { t } = useI18n();
  const [snap, setSnap] = useState<StockSnapshot | null>(null);

  useEffect(() => {
    async function load() {
      const [deliveriesRes, batchesRes, weighRes, dispatchRes] = await Promise.all([
        supabase.from("deliveries").select("id, gross_weight_kg, batch_id, contracts(season_closed)").limit(1000),
        supabase.from("batches").select("id, batch_code, status, crop_type, variety, created_date").limit(1000),
        supabase.from("batch_weigh_points").select("batch_id, stage, weight_kg, moisture_pct, estimated, recorded_date").limit(1000),
        supabase.from("dispatches").select("product, weight_kg, price_per_kg").limit(1000),
      ]);
      const failed = [deliveriesRes, batchesRes, weighRes, dispatchRes].find((r) => r.error);
      if (failed) {
        ok(failed.error, "Load stock");
        return;
      }
      // Closed seasons (Davy's settled dry 25/26 ledger) are history, not paddy in the yard.
      setSnap(stockSnapshot(openOnly(deliveriesRes.data ?? []), batchesRes.data ?? [], weighRes.data ?? [], dispatchRes.data ?? []));
    }
    load();
  }, []);

  if (!snap) return <div className="p-6 text-muted-foreground">…</div>;

  const empty =
    snap.intakeDeliveryCount === 0 && snap.perBatch.length === 0;
  // FIFO pick list: oldest stock first, one variety per dryer (mill manager, 8 Sep 2026).
  const groups = millNext(snap.perBatch, new Date().toISOString().slice(0, 10));

  const outputRows: { label: string; produced: number; dispatched: number; onHand: number }[] = [
    { label: t("stock.headRice"), produced: snap.outputs.headRiceKg, dispatched: snap.dispatched.headRiceKg, onHand: snap.onHand.headRiceKg },
    { label: t("stock.broken"), produced: snap.outputs.brokenKg, dispatched: snap.dispatched.brokenKg, onHand: snap.onHand.brokenKg },
    { label: t("stock.bran"), produced: snap.outputs.branKg, dispatched: snap.dispatched.branKg, onHand: snap.onHand.branKg },
    { label: t("stock.husk"), produced: snap.outputs.huskKg, dispatched: snap.dispatched.huskKg, onHand: snap.onHand.huskKg },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("stock.title")}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t("stock.subtitle")}</p>
      </div>

      {empty ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">{t("stock.empty")}</CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{t("stock.intakeWet")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{kg(snap.intakeWetKg)}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {snap.intakeDeliveryCount} {t("stock.awaitingBatch")}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{t("stock.driedAwaiting")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{(snap.driedAwaitingEstimated ? "≈ " : "") + kg(snap.driedAwaitingMillKg)}</div>
                {snap.driedAwaitingEstimated && <p className="text-xs text-muted-foreground mt-1">{t("stock.about")}</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{t("stock.totalOutputs")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{kg(snap.totalOnHandKg)}</div>
              </CardContent>
            </Card>
          </div>

          {groups.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("stock.millNext")}</CardTitle>
                <p className="text-xs text-muted-foreground">{t("stock.millNextHint")}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {groups.map((g) => (
                  <div key={g.variety}>
                    <p className="text-sm font-medium">{g.variety}</p>
                    <ul className="mt-1 space-y-1 text-sm">
                      {g.rows.map((r, i) => (
                        <li key={r.batchId} className="flex items-center gap-2">
                          <span className={`num w-5 text-xs ${i === 0 ? "text-primary" : "text-muted-foreground"}`}>{i + 1}</span>
                          <Link to="/batches/$batchId" params={{ batchId: r.batchId }} className="font-medium text-primary hover:underline">
                            {r.batchCode}
                          </Link>
                          <span className="num text-muted-foreground">{(r.inStoreEstimated ? "≈ " : "") + kg(r.driedAwaitingMillKg)}</span>
                          {r.daysInStore !== null && (
                            <span className="text-muted-foreground">
                              · {r.daysInStore} {t("stock.daysInStore")}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("stock.outputsTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("stock.colOutputs")}</TableHead>
                    <TableHead className="text-right">{t("stock.totalOutputs")}</TableHead>
                    <TableHead className="text-right">{t("stock.colDispatched")}</TableHead>
                    <TableHead className="text-right">{t("stock.colOnHand")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outputRows.map((r) => (
                    <TableRow key={r.label}>
                      <TableCell className="font-medium">{r.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{kg(r.produced)}</TableCell>
                      <TableCell className="text-right tabular-nums">{kg(r.dispatched)}</TableCell>
                      <TableCell className={"text-right tabular-nums font-medium" + (r.onHand < 0 ? " text-destructive" : "")}>{kg(r.onHand)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="text-muted-foreground">{t("stock.wastage")}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{kg(snap.wastageKg)}</TableCell>
                    <TableCell />
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("stock.perBatch")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("stock.colBatch")}</TableHead>
                    <TableHead>{t("stock.colVariety")}</TableHead>
                    <TableHead>{t("stock.colStatus")}</TableHead>
                    <TableHead className="text-right">{t("stock.colReceived")}</TableHead>
                    <TableHead className="text-right">{t("stock.colDried")}</TableHead>
                    <TableHead className="text-right">{t("stock.colIntoMill")}</TableHead>
                    <TableHead className="text-right">{t("stock.colAwaiting")}</TableHead>
                    <TableHead className="text-right">{t("stock.colOutputs")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snap.perBatch.map((row) => (
                    <TableRow key={row.batchId}>
                      <TableCell>
                        <Link to="/batches/$batchId" params={{ batchId: row.batchId }} className="font-medium text-primary hover:underline">
                          {row.batchCode}
                        </Link>
                      </TableCell>
                      <TableCell>{row.variety ?? "—"}</TableCell>
                      <TableCell className="capitalize">{row.status}</TableCell>
                      <TableCell className="text-right tabular-nums">{kg(row.receivedKg)}</TableCell>
                      <TableCell className="text-right tabular-nums">{kg(row.driedKg)}</TableCell>
                      <TableCell className="text-right tabular-nums">{kg(row.intoMillKg)}</TableCell>
                      <TableCell className="text-right tabular-nums">{(row.inStoreEstimated ? "≈ " : "") + kg(row.driedAwaitingMillKg)}</TableCell>
                      <TableCell className="text-right tabular-nums">{kg(row.outputsKg)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
