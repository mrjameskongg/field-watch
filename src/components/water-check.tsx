// Radar water cross-check card: what Sentinel-1 saw, next to what the field
// officer logged. The disagreements are the point — an MRV auditor trusts a
// record that admits where its two sources diverge far more than one that
// reports a clean sweep.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ok } from "@/lib/supabase-helpers";
import { useI18n, type I18nKey } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, CircleHelp, Droplets, Minus, Radar, TriangleAlert } from "lucide-react";
import {
  agreementRate,
  classifyWater,
  crossCheck,
  satelliteDrySpells,
  type Agreement,
  type CrossCheck,
  type LoggedWaterEvent,
  type WaterReading,
} from "@/lib/water-core";
import { awdSummary, type AwdEvent } from "@/lib/awd-core";

interface Row extends WaterReading {
  state: string;
  confident: boolean;
}

export interface WaterCrossCheckData {
  rows: Row[];
  checks: CrossCheck[];
  loaded: boolean;
}

/**
 * Shared fetch for the radar water cross-check: parcel_water readings plus
 * the logged water events they are checked against, both windowed to the
 * last 120 days. Lifted out of WaterCheckCard so a page that also wants the
 * AWD summary (which needs the same CrossCheck rows) can load this once and
 * hand the result to both cards instead of fetching it twice.
 */
export function useWaterCrossCheck(farmId: string): WaterCrossCheckData {
  const [rows, setRows] = useState<Row[]>([]);
  const [checks, setChecks] = useState<CrossCheck[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      const since = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const [waterRes, eventsRes] = await Promise.all([
        supabase
          .from("parcel_water")
          .select("reading_date, vv_db, vh_db, state, confident")
          .eq("farm_id", farmId)
          .gte("reading_date", since)
          .order("reading_date", { ascending: false }),
        supabase
          .from("field_events")
          .select("event_date, water_state")
          .eq("farm_id", farmId)
          .eq("event_type", "water")
          .gte("event_date", since),
      ]);
      setLoaded(true);
      if (!ok(waterRes.error, "Load radar readings")) return;
      ok(eventsRes.error, "Load water events");

      const water = (waterRes.data ?? []) as Row[];
      const events = (eventsRes.data ?? []) as LoggedWaterEvent[];
      setRows(water);
      setChecks(water.map((r) => crossCheck(r, classifyWater(r), events)));
    }
    load();
  }, [farmId]);

  return { rows, checks, loaded };
}

const AGREEMENT_META: Record<
  Agreement,
  { key: I18nKey; icon: typeof Check; className: string }
> = {
  agrees: { key: "water.agrees", icon: Check, className: "bg-chart-2/15 text-chart-2" },
  disagrees: { key: "water.disagrees", icon: TriangleAlert, className: "bg-destructive/15 text-destructive" },
  unconfirmed: { key: "water.unconfirmed", icon: Minus, className: "bg-muted text-muted-foreground" },
  inconclusive: { key: "water.inconclusive", icon: CircleHelp, className: "bg-muted text-muted-foreground" },
};

const STATE_KEY: Record<string, I18nKey> = {
  flooded: "water.flooded",
  drained: "water.drained",
  uncertain: "water.uncertain",
};

/**
 * Card body, given already-loaded data. Split out from WaterCheckCard so a
 * page that also renders AwdCard can fetch once (via useWaterCrossCheck) and
 * pass the result to both, instead of each card firing its own query.
 */
function WaterCheckCardView({ data }: { data: WaterCrossCheckData }) {
  const { t } = useI18n();
  const { rows, checks, loaded } = data;

  if (!loaded) return null;

  const rate = agreementRate(checks);
  const drySpells = satelliteDrySpells(rows.map((r) => ({ state: r.state as "flooded" | "drained" | "uncertain" })));

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <Radar className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">{t("water.title")}</CardTitle>
          {rate !== null && (
            <Badge variant="secondary" className="ml-auto bg-primary/10 text-primary">
              {t("water.agreementRate")} {rate}%
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{t("water.subtitle")}</p>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("water.noReadings")}</p>
        ) : (
          <>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-xl font-bold leading-none">{drySpells}</div>
              <div className="mt-1 text-xs text-muted-foreground">{t("water.satelliteDrySpells")}</div>
            </div>

            <div className="space-y-1.5">
              {rows.slice(0, 6).map((r, i) => {
                const check = checks[i];
                const meta = AGREEMENT_META[check.agreement];
                const Icon = meta.icon;
                return (
                  <div key={r.reading_date} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      {r.reading_date}
                    </span>
                    <span className="font-medium">{t(STATE_KEY[r.state] ?? "water.uncertain")}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      VV {r.vv_db} dB
                    </span>
                    <Badge variant="secondary" className={`${meta.className} gap-1 text-xs`}>
                      <Icon className="h-3 w-3" />
                      {t(meta.key)}
                    </Badge>
                    {!r.confident && (
                      <span className="text-xs text-muted-foreground">{t("water.lowConfidence")}</span>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="border-t pt-2 text-xs text-muted-foreground">{t("water.evidenceNote")}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Self-fetching variant, used when a page renders only this card and has no
 *  reason to lift the fetch up. */
function WaterCheckCardSelfFetching({ farmId }: { farmId: string }) {
  const data = useWaterCrossCheck(farmId);
  return <WaterCheckCardView data={data} />;
}

export function WaterCheckCard({ farmId, data }: { farmId: string; data?: WaterCrossCheckData }) {
  if (data) return <WaterCheckCardView data={data} />;
  return <WaterCheckCardSelfFetching farmId={farmId} />;
}

/* ------------------------------------------------------------------ */
/* AWD season summary                                                  */
/* ------------------------------------------------------------------ */

const VERDICT_META: Record<
  AwdSummaryVerdict,
  { key: I18nKey; className: string }
> = {
  confirmed: { key: "awd.verdict.confirmed", className: "bg-chart-2/10 text-chart-2" },
  partial: { key: "awd.verdict.partial", className: "bg-amber-500/10 text-amber-600" },
  unverified: { key: "awd.verdict.unverified", className: "bg-muted text-muted-foreground" },
  none: { key: "awd.verdict.none", className: "bg-muted text-muted-foreground" },
};

type AwdSummaryVerdict = ReturnType<typeof awdSummary>["verdict"];
type CropCycle = { id: string; status: string; planting_date: string };

/** Card body, given the farm-wide cross-check data. Fetches its own
 *  cycle-scoped events (the AWD cycle count is season-specific, unlike the
 *  cross-check data which is shared with WaterCheckCard). */
function AwdCardView({ farmId, crossCheckData }: { farmId: string; crossCheckData: WaterCrossCheckData }) {
  const { t } = useI18n();
  const { checks, loaded: crossCheckLoaded } = crossCheckData;

  const [cycle, setCycle] = useState<CropCycle | null | undefined>(undefined); // undefined = loading, null = none
  const [events, setEvents] = useState<AwdEvent[]>([]);

  useEffect(() => {
    async function load() {
      const { data: cycles, error } = await supabase
        .from("crop_cycles")
        .select("id, status, planting_date")
        .eq("farm_id", farmId)
        .order("planting_date", { ascending: false });
      if (!ok(error, "Load crop cycles")) {
        setCycle(null);
        return;
      }
      const active = (cycles ?? []).find((c) => c.status === "active") ?? null;
      const target = active ?? cycles?.[0] ?? null;
      setCycle(target);
      if (!target) {
        setEvents([]);
        return;
      }
      const { data: eventRows, error: evErr } = await supabase
        .from("field_events")
        .select("event_type, water_state, event_date")
        .eq("cycle_id", target.id)
        .eq("event_type", "water");
      if (!ok(evErr, "Load season water events")) return;
      setEvents((eventRows ?? []) as AwdEvent[]);
    }
    load();
  }, [farmId]);

  const loaded = cycle !== undefined && crossCheckLoaded;
  if (!loaded) return null;

  const summary = cycle ? awdSummary(events, checks) : awdSummary([], []);
  const meta = VERDICT_META[summary.verdict];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <Droplets className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">{t("awd.title")}</CardTitle>
          <Badge variant="secondary" className={`ml-auto ${meta.className}`}>
            {t(meta.key)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!cycle ? (
          <p className="text-sm text-muted-foreground">{t("awd.noCycle")}</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-xl font-bold leading-none">{summary.cycles}</div>
              <div className="mt-1 text-xs text-muted-foreground">{t("awd.cycles")}</div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-xl font-bold leading-none">{summary.radarPasses}</div>
              <div className="mt-1 text-xs text-muted-foreground">{t("awd.radarPasses")}</div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-xl font-bold leading-none">
                {summary.agreementPct !== null ? `${summary.agreementPct}%` : "—"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{t("awd.agreementPct")}</div>
            </div>
          </div>
        )}

        <p className="border-t pt-2 text-xs text-muted-foreground">{t("awd.caption")}</p>
      </CardContent>
    </Card>
  );
}

/** Self-fetching variant, used when a page renders only this card and has no
 *  reason to lift the cross-check fetch up. */
function AwdCardSelfFetching({ farmId }: { farmId: string }) {
  const crossCheckData = useWaterCrossCheck(farmId);
  return <AwdCardView farmId={farmId} crossCheckData={crossCheckData} />;
}

/**
 * AWD (Alternate Wetting & Drying) season summary: how many dry-down cycles
 * field staff logged this season, and how well an independent Sentinel-1
 * radar pass backs that log up. Cycles are scoped to the active crop cycle
 * (or, once a season has closed, the most recent one) — a farm-wide count
 * would blur seasons together and make the cycle number meaningless.
 *
 * `crossCheckData` (parcel_water rows + CrossCheck[]) is farm-wide over the
 * last 120 days, same as WaterCheckCard: pass the same object down from the
 * page that already loaded it via useWaterCrossCheck to avoid a duplicate
 * fetch, or omit it to let this card fetch it itself.
 */
export function AwdCard({ farmId, crossCheckData }: { farmId: string; crossCheckData?: WaterCrossCheckData }) {
  if (crossCheckData) return <AwdCardView farmId={farmId} crossCheckData={crossCheckData} />;
  return <AwdCardSelfFetching farmId={farmId} />;
}
