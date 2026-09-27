// Farmer ranking: transparent composite score. Every column that feeds the
// score is on the table, so a farmer's grade can always be explained at the
// farm gate.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { rankFarmers, type Grade, type RankInput, type RankedFarmer } from "@/lib/ranking-core";
import { currentSeasonInputs, loadRankingData } from "@/lib/ranking-load";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { asCurrency, fmtMoney, sumByCurrency, type Currency } from "@/lib/money-core";

export const Route = createFileRoute("/_authenticated/ranking")({
  component: RankingPage,
});

const gradeClass: Record<Grade, string> = {
  A: "bg-chart-2/10 text-chart-2",
  B: "bg-primary/10 text-primary",
  C: "bg-chart-4/10 text-chart-4",
  D: "bg-destructive/10 text-destructive",
};

type ClosedRow = {
  farmerId: string;
  name: string;
  seasons: string;
  lots: number;
  kg: number;
  value: Record<Currency, number>;
};

function RankingPage() {
  const { t } = useI18n();
  const [ranked, setRanked] = useState<RankedFarmer[] | null>(null);
  const [unranked, setUnranked] = useState<RankInput[]>([]);
  const [closed, setClosed] = useState<ClosedRow[]>([]);
  const [view, setView] = useState<"open" | "closed">("open");

  useEffect(() => {
    async function load() {
      const data = await loadRankingData();
      if (!data) return;

      // Closed seasons are graded by nobody: they are settled history. They get
      // their own table so last season's farmers are not "not enough data".
      const allContracts = data.contracts;
      const closedRows: ClosedRow[] = [];
      for (const f of data.farmers) {
        const mine = allContracts.filter((c) => c.farmer_id === f.id && c.season_closed && c.status !== "cancelled");
        if (mine.length === 0) continue;
        const ids = new Set(mine.map((c) => c.id));
        const cur = new Map(mine.map((c) => [c.id, asCurrency(c.currency)]));
        const lots = data.deliveries.filter((d) => ids.has(d.contract_id));
        closedRows.push({
          farmerId: f.id,
          name: f.full_name,
          seasons: Array.from(new Set(mine.map((c) => c.season_label))).join(", "),
          lots: lots.length,
          kg: lots.reduce((s, d) => s + d.gross_weight_kg, 0),
          value: sumByCurrency(lots, (d) => d.gross_weight_kg * d.price_per_kg_applied, (d) => cur.get(d.contract_id)),
        });
      }
      closedRows.sort((a, b) => b.kg - a.kg || a.name.localeCompare(b.name));
      setClosed(closedRows);
      const closedFarmerIds = new Set(closedRows.map((r) => r.farmerId));

      const inputs = currentSeasonInputs(data);
      const result = rankFarmers(inputs);
      setRanked(result.ranked);
      // A farmer with closed-season history is not "missing data" — they sit in the closed table.
      setUnranked(result.unranked.filter((u) => !closedFarmerIds.has(u.farmerId)));
    }
    load();
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t("rank.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("rank.subtitle")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <Button variant={view === "open" ? "default" : "outline"} size="sm" onClick={() => setView("open")}>
          {t("rank.seasonOpen")}
        </Button>
        <Button variant={view === "closed" ? "default" : "outline"} size="sm" onClick={() => setView("closed")}>
          {t("rank.seasonClosed")} · {closed.length}
        </Button>
        {view === "open" && closed.length > 0 && (
          <span className="ml-2 text-xs text-muted-foreground">
            {closed.length} {t("rank.closedNote")}
          </span>
        )}
      </div>

      {view === "closed" && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("rank.rank")}</TableHead>
                    <TableHead>{t("rank.farmer")}</TableHead>
                    <TableHead>{t("rank.season")}</TableHead>
                    <TableHead className="text-right">{t("rank.lots")}</TableHead>
                    <TableHead className="text-right">{t("rank.kgDelivered")}</TableHead>
                    <TableHead className="text-right">{t("rank.value")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {closed.map((r, i) => (
                    <TableRow key={r.farmerId}>
                      <TableCell className="font-semibold">{i + 1}</TableCell>
                      <TableCell>
                        <Link to="/farmers/$farmerId" params={{ farmerId: r.farmerId }} className="text-primary hover:underline font-medium">
                          {r.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.seasons}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.lots}</TableCell>
                      <TableCell className="text-right tabular-nums">{Math.round(r.kg).toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap">
                        {r.value.KHR > 0 && <div>{fmtMoney(r.value.KHR, "KHR")}</div>}
                        {r.value.USD > 0 && <div>{fmtMoney(r.value.USD, "USD")}</div>}
                        {r.value.KHR === 0 && r.value.USD === 0 && "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {closed.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="p-8 text-center text-muted-foreground">{t("rank.closedEmpty")}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {view === "open" && (
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("rank.rank")}</TableHead>
                  <TableHead>{t("rank.farmer")}</TableHead>
                  <TableHead>{t("rank.grade")}</TableHead>
                  <TableHead>{t("rank.score")}</TableHead>
                  <TableHead>{t("rank.delivered")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("rank.fulfilment")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("rank.quality")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("rank.clean")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t("rank.passed")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t("rank.wet")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t("rank.burn")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(ranked ?? []).map((r, i) => (
                  <TableRow key={r.farmerId}>
                    <TableCell className="font-semibold">{i + 1}</TableCell>
                    <TableCell>
                      <Link to="/farmers/$farmerId" params={{ farmerId: r.farmerId }} className="text-primary hover:underline font-medium">
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`${gradeClass[r.grade]} text-sm font-bold`}>{r.grade}</Badge>
                    </TableCell>
                    <TableCell className="font-semibold">{r.score}</TableCell>
                    <TableCell>
                      {Math.round(r.deliveredKg).toLocaleString()} / {Math.round(r.expectedKg).toLocaleString()} kg
                      <span className="text-muted-foreground"> · {r.fulfilmentPct}%</span>
                      {r.overContract && <Badge variant="destructive" className="ml-1">{t("rank.overContract")}</Badge>}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{r.fulfilmentPts}</TableCell>
                    <TableCell className="hidden md:table-cell">{r.qualityPts}</TableCell>
                    <TableCell className="hidden md:table-cell">{r.cleanPts}</TableCell>
                    <TableCell className="hidden lg:table-cell">{r.passedLoads} / {r.testedLoads} ({r.totalLoads} {t("rank.loads").toLowerCase()})</TableCell>
                    <TableCell className="hidden lg:table-cell">{r.wetLoads || "—"}</TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {r.activeBurnAlerts > 0 ? <Badge variant="destructive">{r.activeBurnAlerts}</Badge> : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {ranked !== null && ranked.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">{t("rank.empty")}</div>
          )}
        </CardContent>
      </Card>
      )}

      {view === "open" && unranked.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="text-sm font-medium">{t("rank.unranked")}</div>
            <p className="text-xs text-muted-foreground">{t("rank.unrankedWhy")}</p>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {unranked.map((f) => (
              <Link key={f.farmerId} to="/farmers/$farmerId" params={{ farmerId: f.farmerId }}>
                <Badge variant="outline" className="hover:bg-muted">{f.name}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
