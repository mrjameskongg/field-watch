// Water discipline: the parcels being kept flooded when they should have been
// let dry. Step two of Richard's ask — step one (is this field dry?) is the
// Sentinel-1 scan that fills parcel_water from the map page.
//
// Worst first, because the point of the screen is the top of the list.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Droplets } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ok } from "@/lib/supabase-helpers";
import { useI18n } from "@/lib/i18n";
import { addDays } from "@/lib/water-core";
import {
  DEFAULT_PUMPING_RULE,
  dieselPerHa,
  dieselSignal,
  floodStreak,
  median,
  pumpFlag,
  sortByPumping,
  type AdvanceRow,
  type PumpFlag,
  type PumpingRow,
} from "@/lib/pumping-core";

type AdvanceWithContract = AdvanceRow & { contract_id: string };

export const Route = createFileRoute("/_authenticated/water")({
  component: WaterPage,
});

/** Matches the AWD card's farm-wide window — roughly one season of passes. */
const WINDOW_DAYS = 120;

const RULE_STORAGE_KEY = "fw.pumping.flagAfterDays";

const flagClass: Record<PumpFlag, string> = {
  "never-dried": "bg-destructive/10 text-destructive",
  watch: "bg-chart-4/10 text-chart-4",
  ok: "bg-chart-2/10 text-chart-2",
  stale: "bg-muted text-muted-foreground",
  "no-data": "bg-muted text-muted-foreground",
};

const flagKey: Record<PumpFlag, "wd.flagNeverDried" | "wd.flagWatch" | "wd.flagOk" | "wd.flagStale" | "wd.flagNoData"> = {
  "never-dried": "wd.flagNeverDried",
  watch: "wd.flagWatch",
  ok: "wd.flagOk",
  stale: "wd.flagStale",
  "no-data": "wd.flagNoData",
};

function readStoredRule(): number {
  if (typeof window === "undefined") return DEFAULT_PUMPING_RULE.flagAfterDays;
  const raw = window.localStorage.getItem(RULE_STORAGE_KEY);
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PUMPING_RULE.flagAfterDays;
}

function WaterPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<PumpingRow[] | null>(null);
  const [flagAfterDays, setFlagAfterDays] = useState(DEFAULT_PUMPING_RULE.flagAfterDays);
  const [estateMedian, setEstateMedian] = useState<number | null>(null);

  useEffect(() => {
    setFlagAfterDays(readStoredRule());
  }, []);

  useEffect(() => {
    async function load() {
      const today = new Date().toISOString().slice(0, 10);
      const since = addDays(today, -WINDOW_DAYS);

      // Same scoped-aggregate pattern as /ranking; each capped at 1000 — this
      // moves to a DB view once the estate outgrows that.
      const [farmsRes, farmersRes, waterRes, eventsRes, contractsRes] = await Promise.all([
        supabase.from("farms").select("id, farm_name, farmer_id, area_hectares, boundary_geojson").limit(1000),
        supabase.from("farmers").select("id, full_name").limit(1000),
        supabase
          .from("parcel_water")
          .select("farm_id, reading_date, state, confident")
          .gte("reading_date", since)
          .limit(1000),
        supabase
          .from("field_events")
          .select("farm_id, event_type, water_state, event_date")
          .eq("event_type", "water")
          .gte("event_date", since)
          .limit(1000),
        supabase.from("contracts").select("id, farm_id, contracted_hectares, status").limit(1000),
      ]);

      const failed = [farmsRes, farmersRes, waterRes, eventsRes, contractsRes].find((r) => r.error);
      if (failed) {
        ok(failed.error, "Load water discipline");
        return;
      }

      const contracts = (contractsRes.data ?? []).filter((c) => c.status !== "cancelled");
      const contractIds = contracts.map((c) => c.id);
      const advancesRes = contractIds.length
        ? await supabase
            .from("input_advances")
            .select("contract_id, item_type, quantity, unit")
            .in("contract_id", contractIds)
            .limit(1000)
        : { data: [], error: null };
      if (advancesRes.error) {
        ok(advancesRes.error, "Load water discipline");
        return;
      }

      const advances = (advancesRes.data ?? []) as AdvanceWithContract[];

      const farmerName = new Map((farmersRes.data ?? []).map((f) => [f.id, f.full_name]));

      // Radar only ever scans parcels that have a drawn boundary, so a farm
      // without one is absent by definition rather than compliant.
      const mapped = (farmsRes.data ?? []).filter((f) => f.boundary_geojson !== null);

      const built = mapped.map((farm) => {
        const passes = (waterRes.data ?? []).filter((w) => w.farm_id === farm.id);
        const logs = (eventsRes.data ?? []).filter((e) => e.farm_id === farm.id);
        const streak = floodStreak(passes, logs);

        const myContracts = contracts.filter((c) => c.farm_id === farm.id);
        const myContractIds = new Set(myContracts.map((c) => c.id));
        const myAdvances = advances.filter((a) => myContractIds.has(a.contract_id));
        // Contracted hectares is the area the fuel was advanced against;
        // the mapped farm area is the fallback when no contract says.
        const hectares =
          myContracts.reduce((s, c) => s + (c.contracted_hectares ?? 0), 0) || (farm.area_hectares ?? 0);

        return {
          ...streak,
          farmId: farm.id,
          farmName: farm.farm_name,
          farmerName: farmerName.get(farm.farmer_id) ?? null,
          flag: pumpFlag(
            {
              latestPass: streak.latestPass,
              today,
              daysFlooded: streak.daysFlooded,
              neverDrained: streak.neverDrained,
            },
            { flagAfterDays },
          ),
          dieselPerHa: dieselPerHa(myAdvances, hectares),
          diesel: "unknown",
        } satisfies PumpingRow;
      });

      const med = median(built.map((r) => r.dieselPerHa).filter((v): v is number => v !== null));
      setEstateMedian(med);
      setRows(sortByPumping(built.map((r) => ({ ...r, diesel: dieselSignal(r.dieselPerHa, med) }))));
    }
    load();
  }, [flagAfterDays]);

  const counted = (flag: PumpFlag) => (rows ?? []).filter((r) => r.flag === flag).length;

  const onRuleChange = (value: string) => {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setFlagAfterDays(parsed);
    window.localStorage.setItem(RULE_STORAGE_KEY, String(parsed));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Droplets className="h-6 w-6 text-primary" />
            {t("wd.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("wd.subtitle")}</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label htmlFor="flagAfterDays" className="text-xs">{t("wd.rule")}</Label>
            <Input
              id="flagAfterDays"
              type="number"
              min={1}
              className="w-24"
              value={flagAfterDays}
              onChange={(e) => onRuleChange(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-destructive">{counted("never-dried")}</div>
            <div className="text-xs text-muted-foreground">{t("wd.flagNeverDried")}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-chart-4">{counted("watch")}</div>
            <div className="text-xs text-muted-foreground">{t("wd.flagWatch")}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">
              {estateMedian === null ? "—" : `${estateMedian.toFixed(1)} L/ha`}
            </div>
            <div className="text-xs text-muted-foreground">{t("wd.medianDiesel")}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("wd.parcel")}</TableHead>
                  <TableHead>{t("wd.farmer")}</TableHead>
                  <TableHead>{t("wd.status")}</TableHead>
                  <TableHead>{t("wd.daysFlooded")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("wd.passes")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("wd.lastDry")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t("wd.diesel")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t("wd.lastPass")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rows ?? []).map((r) => (
                  <TableRow key={r.farmId}>
                    <TableCell>
                      <Link
                        to="/farms/$farmId"
                        params={{ farmId: r.farmId }}
                        className="text-primary hover:underline font-medium"
                      >
                        {r.farmName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.farmerName ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={flagClass[r.flag]}>{t(flagKey[r.flag])}</Badge>
                    </TableCell>
                    <TableCell className="font-semibold">
                      {r.latestPass ? `${r.daysFlooded} ${t("wd.days")}` : "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{r.passes || "—"}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {r.lastDrainedDate ?? t("wd.never")}
                      {r.confirmedDry && (
                        <Badge variant="outline" className="ml-1">{t("wd.radarConfirmed")}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {r.dieselPerHa === null ? (
                        "—"
                      ) : (
                        <>
                          {r.dieselPerHa.toFixed(1)} L/ha
                          {r.diesel === "above" && (
                            <Badge variant="secondary" className="ml-1 bg-chart-4/10 text-chart-4">
                              {t("wd.dieselAbove")}
                            </Badge>
                          )}
                        </>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-muted-foreground">
                      {r.latestPass ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {rows !== null && rows.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">{t("wd.empty")}</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="text-sm font-medium">{t("wd.limitsTitle")}</div>
        </CardHeader>
        <CardContent className="space-y-1 text-xs text-muted-foreground">
          <p>{t("wd.limitSurface")}</p>
          <p>{t("wd.limitRevisit")}</p>
          <p>{t("wd.limitDiesel")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
