// Mill at a glance. Six regions, every number derived from ledger rows by
// dashboard-core / grade-core / pumping-core so it cannot disagree with the
// pages it links to. Open seasons only — a closed season is history.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, Droplets, FlaskConical, Sprout, Truck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { EstateTile } from "@/components/estate-tile";
import { useI18n, formatLongDate, type I18nKey } from "@/lib/i18n";
import { useFx } from "@/lib/fx";
import { asCurrency, fmtMoney, usdEquivalent, type Currency } from "@/lib/money-core";
import { stressedCount, type HealthRow } from "@/lib/health-core";
import { useSatelliteFreshness } from "@/lib/freshness";
import {
  freshnessLabel,
  moneyStrip,
  openBatchBalance,
  radarAgreement,
  recentActivity,
  type ActivityRow,
} from "@/lib/dashboard-core";
import { EXPORT_GRADE_DEFAULTS, batchExportGrade, premiumUnlockedUsd, type GradeRule } from "@/lib/grade-core";
import { DEFAULT_PUMPING_RULE, floodStreak, pumpFlag, type PumpFlag } from "@/lib/pumping-core";
import { ok } from "@/lib/supabase-helpers";
import { alertTypeLabel } from "@/lib/labels";
import { useAuth } from "@/lib/auth";
import { canRead } from "@/lib/roles-core";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

type Loaded = {
  deliveries: {
    delivery_code: string;
    received_date: string;
    gross_weight_kg: number;
    price_per_kg_applied: number;
    settlement_id: string | null;
    moisture_flagged: boolean | null;
    contracts: { currency: string; season_closed: boolean; farmers: { full_name: string } | null } | null;
  }[];
  settlements: { settlement_code: string; status: string; net_payment: number; settled_date: string; contracts: { currency: string; season_closed: boolean } | null }[];
  batches: { id: string; batch_code: string; status: string }[];
  weighPoints: { batch_id: string; stage: string; weight_kg: number; moisture_pct: number | null; recorded_date: string }[];
  dispatches: { dispatch_code: string; dispatched_date: string; product: string; weight_kg: number }[];
  alerts: { id: string; alert_type: string; severity: string; detected_date: string; farms: { farm_name: string } | null }[];
  openAlertCount: number;
  qcFailures: number;
  health: HealthRow[];
  water: { farm_id: string; reading_date: string; state: string; confident: boolean }[];
  waterLogs: { farm_id: string; event_date: string; event_type: string; water_state: string | null }[];
  farms: { id: string; area_hectares: number | null }[];
  farmerCount: number;
  gradeRule: GradeRule;
};

const KIND_KEY: Record<ActivityRow["kind"], I18nKey> = {
  delivery: "dash.kindDelivery",
  weigh: "dash.kindWeigh",
  payment: "dash.kindPayment",
  dispatch: "dash.kindDispatch",
};

function readPumpingRule(): { flagAfterDays: number } {
  try {
    const v = Number(localStorage.getItem("fw.pumping.flagAfterDays"));
    return Number.isFinite(v) && v > 0 ? { flagAfterDays: v } : DEFAULT_PUMPING_RULE;
  } catch {
    return DEFAULT_PUMPING_RULE;
  }
}

const OFFICE_ONLY = [{ text: "Office only", sub: "Admin and Manager" }];

function DashboardPage() {
  const { viewRoles } = useAuth();
  const canSeeMoney = canRead(viewRoles, "settlements");
  const { t, lang } = useI18n();
  const { khrPerUsd } = useFx();
  const fresh = useSatelliteFreshness();
  const [data, setData] = useState<Loaded | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    async function load() {
      const since90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const since30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const [
        deliveriesRes, settlementsRes, batchesRes, weighRes, dispatchRes, alertsRes, alertCountRes, qcFailRes,
        healthRes, waterRes, logsRes, farmsRes, farmersRes, gradeRes,
      ] = await Promise.all([
        supabase
          .from("deliveries")
          .select("delivery_code, received_date, gross_weight_kg, price_per_kg_applied, settlement_id, moisture_flagged, contracts(currency, season_closed, farmers(full_name))")
          .order("received_date", { ascending: false })
          .limit(1000),
        supabase.from("settlements").select("settlement_code, status, net_payment, settled_date, contracts(currency, season_closed)").limit(1000),
        supabase.from("batches").select("id, batch_code, status").limit(1000),
        supabase.from("batch_weigh_points").select("batch_id, stage, weight_kg, moisture_pct, recorded_date").limit(1000),
        supabase.from("dispatches").select("dispatch_code, dispatched_date, product, weight_kg").order("dispatched_date", { ascending: false }).limit(200),
        supabase
          .from("alerts")
          .select("id, alert_type, severity, detected_date, farms(farm_name)")
          .in("status", ["new", "investigating"])
          .order("detected_date", { ascending: false })
          .limit(6),
        supabase.from("alerts").select("id", { count: "exact", head: true }).in("status", ["new", "investigating"]),
        supabase
          .from("qc_tests")
          .select("id, deliveries!inner(contracts!inner(season_closed))", { count: "exact", head: true })
          .eq("passed", false)
          .eq("deliveries.contracts.season_closed", false),
        supabase.from("parcel_health").select("farm_id, reading_date, ndvi_mean, ndmi_mean, cloud_pct").gte("reading_date", since90).limit(1000),
        supabase.from("parcel_water").select("farm_id, reading_date, state, confident").gte("reading_date", since30).limit(1000),
        supabase.from("field_events").select("farm_id, event_date, event_type, water_state").eq("event_type", "water").gte("event_date", since30).limit(1000),
        supabase.from("farms").select("id, area_hectares").limit(1000),
        supabase.from("farmers").select("id", { count: "exact", head: true }),
        supabase.from("app_settings").select("value").eq("key", "export_grade").maybeSingle(),
      ]);
      const failed = [deliveriesRes, settlementsRes, batchesRes, weighRes, dispatchRes, alertsRes, healthRes, waterRes, logsRes, farmsRes].find((r) => r.error);
      if (failed) {
        ok(failed.error, "Load dashboard");
        return;
      }
      const gv = gradeRes.data?.value;
      const gradeRule: GradeRule =
        gv && typeof gv === "object" ? { ...EXPORT_GRADE_DEFAULTS, ...(gv as Partial<GradeRule>) } : EXPORT_GRADE_DEFAULTS;
      setData({
        deliveries: (deliveriesRes.data ?? []) as unknown as Loaded["deliveries"],
        settlements: (settlementsRes.data ?? []) as unknown as Loaded["settlements"],
        batches: batchesRes.data ?? [],
        weighPoints: weighRes.data ?? [],
        dispatches: dispatchRes.data ?? [],
        alerts: (alertsRes.data ?? []) as unknown as Loaded["alerts"],
        openAlertCount: alertCountRes.count ?? 0,
        qcFailures: qcFailRes.count ?? 0,
        health: (healthRes.data ?? []) as HealthRow[],
        water: waterRes.data ?? [],
        waterLogs: logsRes.data ?? [],
        farms: farmsRes.data ?? [],
        farmerCount: farmersRes.count ?? 0,
        gradeRule,
      });
    }
    load();
  }, []);

  const derived = useMemo(() => {
    if (!data) return null;
    const open = data.deliveries.filter((d) => d.contracts?.season_closed !== true);
    const money = moneyStrip(data.deliveries, data.settlements);
    const balance = openBatchBalance(data.batches, data.weighPoints);

    // Export grade per batch, summed across batches that reached milling.
    const batchCode = new Map(data.batches.map((b) => [b.id, b.batch_code]));
    const byBatch = new Map<string, Loaded["weighPoints"]>();
    for (const p of data.weighPoints) byBatch.set(p.batch_id, [...(byBatch.get(p.batch_id) ?? []), p]);
    let exportKg = 0;
    let milledBatches = 0;
    let gradeNote: string | null = null;
    for (const [batchId, pts] of byBatch) {
      const g = batchExportGrade(pts, data.gradeRule);
      if (g.headKg > 0) milledBatches++;
      if (g.exportGrade) exportKg += g.headKg;
      else if (g.headKg > 0 && !gradeNote) gradeNote = `${batchCode.get(batchId) ?? "?"}: ${g.reason}`;
    }

    const activity = recentActivity(
      {
        deliveries: open.slice(0, 40).map((d) => ({
          delivery_code: d.delivery_code, received_date: d.received_date, gross_weight_kg: d.gross_weight_kg,
          farmer: d.contracts?.farmers?.full_name ?? null,
        })),
        weighPoints: data.weighPoints.map((w) => ({ batch_code: batchCode.get(w.batch_id) ?? "?", recorded_date: w.recorded_date, stage: w.stage, weight_kg: w.weight_kg })),
        settlements: data.settlements.filter((s) => s.contracts?.season_closed !== true && s.status === "paid").map((s) => ({
          settlement_code: s.settlement_code, settled_date: s.settled_date, net_payment: s.net_payment, currency: s.contracts?.currency ?? null,
        })),
        dispatches: data.dispatches,
      },
      8,
    );

    // Over-pumped parcels: same reduction as /water, per farm.
    const rule = readPumpingRule();
    const passesByFarm = new Map<string, Loaded["water"]>();
    for (const w of data.water) passesByFarm.set(w.farm_id, [...(passesByFarm.get(w.farm_id) ?? []), w]);
    const logsByFarm = new Map<string, Loaded["waterLogs"]>();
    for (const l of data.waterLogs) logsByFarm.set(l.farm_id, [...(logsByFarm.get(l.farm_id) ?? []), l]);
    let overPumped = 0;
    for (const [farmId, rows] of passesByFarm) {
      const streak = floodStreak(rows, logsByFarm.get(farmId) ?? []);
      const flag: PumpFlag = pumpFlag({ latestPass: streak.latestPass, today, daysFlooded: streak.daysFlooded, neverDrained: streak.neverDrained }, rule);
      if (flag === "never-dried" || flag === "watch") overPumped++;
    }

    const agreement = radarAgreement(data.water, data.waterLogs);
    const wetLoads = open.filter((d) => d.moisture_flagged).length;
    const totalHa = data.farms.reduce((s, f) => s + (f.area_hectares ?? 0), 0);
    const radarPasses = data.water.length;
    const fires30 = data.alerts.filter((a) => a.alert_type === "possible_burn").length;

    return { money, balance, exportKg, milledBatches, gradeNote, activity, overPumped, agreement, wetLoads, totalHa, radarPasses, fires30,
      stressed: stressedCount(data.health), premium: premiumUnlockedUsd(exportKg, data.gradeRule) };
  }, [data, today]);

  const moneyCell = (v: Record<Currency, number>) => {
    const parts: { text: string; sub: string | null }[] = [];
    if (v.USD > 0 || (v.USD === 0 && v.KHR === 0)) parts.push({ text: fmtMoney(v.USD, "USD"), sub: null });
    if (v.KHR > 0) parts.push({ text: fmtMoney(v.KHR, "KHR"), sub: `≈ ${fmtMoney(usdEquivalent(v.KHR, "KHR", khrPerUsd), "USD")}` });
    return parts;
  };

  const quickActions: { key: I18nKey; to: string; icon: typeof Truck }[] = [
    { key: "home.recordDelivery", to: "/deliveries?new=1", icon: Truck },
    { key: "home.logFieldWork", to: "/farms", icon: Sprout },
    { key: "home.reviewAlerts", to: "/alerts", icon: AlertTriangle },
  ];

  const attention: { label: string; value: number; to: string; icon: typeof AlertTriangle; hint: string }[] = derived
    ? [
        { label: t("dash.openAlerts"), value: data?.openAlertCount ?? 0, to: "/alerts", icon: AlertTriangle, hint: t("home.hintAlerts") },
        { label: t("home.wetLoads"), value: derived.wetLoads, to: "/deliveries", icon: Droplets, hint: t("home.hintWet") },
        { label: t("home.qcFailures"), value: data?.qcFailures ?? 0, to: "/qc", icon: FlaskConical, hint: t("home.hintQc") },
        { label: t("dash.overPumped"), value: derived.overPumped, to: "/water", icon: Droplets, hint: t("dash.overPumpedHint") },
        { label: t("dash.parcelsStressed"), value: derived.stressed, to: "/map", icon: Sprout, hint: t("home.hintStressed") },
      ]
    : [];
  const needs = attention.filter((a) => a.value > 0);
  const clear = attention.filter((a) => a.value === 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl">{t("dash.glance")}</h1>
          <p className="num mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            {formatLongDate(new Date(), lang)}
            {data && (
              <>
                {" · "}{data.farmerCount} {t("dash.farmersShort")} · {data.farms.length} {t("dash.farmsShort")} · {Math.round(derived?.totalHa ?? 0).toLocaleString()} ha
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {quickActions.map((a) => (
            <Link
              key={a.key}
              to={a.to}
              className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border px-2.5 text-[13px] hover:border-primary/60 hover:text-primary"
            >
              <a.icon className="h-3.5 w-3.5" />
              {t(a.key)}
            </Link>
          ))}
        </div>
      </div>

      {/* 1 — season money */}
      <Card>
        <CardContent className="grid grid-cols-2 divide-border p-0 md:grid-cols-4 md:divide-x">
          {[
            { label: t("dash.kgBought"), parts: [{ text: `${Math.round(derived?.money.kgBought ?? 0).toLocaleString()} kg`, sub: null }] },
            // Roles that cannot read settlements see that, not a misleading $0.
            { label: t("dash.paid"), parts: !canSeeMoney ? OFFICE_ONLY : derived ? moneyCell(derived.money.paid) : [] },
            { label: t("dash.owed"), parts: !canSeeMoney ? OFFICE_ONLY : derived ? moneyCell(derived.money.owed) : [] },
            {
              label: t("dash.exportGrade"),
              parts: [{
                text: `${Math.round(derived?.exportKg ?? 0).toLocaleString()} kg`,
                sub: derived ? (derived.gradeNote ?? (derived.milledBatches > 0 ? `${derived.milledBatches} ${t("dash.batchesMilled")}` : t("dash.noMilling"))) : null,
              }],
            },
          ].map((cell) => (
            <div key={cell.label} className="px-4 py-3">
              <div className="num text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{cell.label}</div>
              {cell.parts.map((p) => (
                <div key={p.text} className="mt-1">
                  <div className="num text-xl leading-tight">{p.text}</div>
                  {p.sub && <div className="num text-[11px] text-muted-foreground">{p.sub}</div>}
                </div>
              ))}
              {cell.parts.length === 0 && <div className="num mt-1 text-xl text-muted-foreground">…</div>}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-12 gap-3">
        {/* 2 — estate */}
        <EstateTile className="col-span-12 h-72 lg:col-span-7 lg:h-80" />

        {/* 3 — open batches */}
        <Card className="col-span-12 lg:col-span-5">
          <CardContent className="flex h-full flex-col p-4">
            <div className="flex items-baseline justify-between">
              <div className="num text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{t("dash.openBatches")}</div>
              <Link to="/batches" className="num text-[11px] text-primary hover:underline">{derived?.balance.batches ?? 0} {t("dash.open")} →</Link>
            </div>
            {derived && derived.balance.receivedKg > 0 ? (
              <div className="mt-3 space-y-3">
                {[
                  { k: t("dash.received"), v: derived.balance.receivedKg, cls: "bg-[var(--signal-water)]", show: true },
                  { k: t("dash.dried"), v: derived.balance.driedKg, cls: "bg-primary/70", show: true },
                  // Jumbo bags into store: counted, not weighed (mill manager, 8 Sep 2026), hence ≈.
                  {
                    k: (derived.balance.storedEstimated ? "≈ " : "") + t("dash.stored"),
                    v: derived.balance.storedKg,
                    cls: "bg-primary/40",
                    show: derived.balance.storedKg > 0,
                  },
                  { k: t("dash.milledOut"), v: derived.balance.outputsKg, cls: "bg-primary", show: true },
                ]
                  .filter((row) => row.show)
                  .map((row) => (
                  <div key={row.k}>
                    <div className="flex justify-between text-[12px]">
                      <span className="text-muted-foreground">{row.k}</span>
                      <span className="num">{Math.round(row.v).toLocaleString()} kg</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full bg-muted">
                      <div className={`h-1.5 ${row.cls}`} style={{ width: `${Math.min(100, (row.v / derived.balance.receivedKg) * 100)}%` }} />
                    </div>
                  </div>
                ))}
                <div className="flex justify-between border-t border-border pt-2 text-[12px]">
                  <span className="text-muted-foreground">{t("dash.unaccounted")}</span>
                  <span className={`num ${derived.balance.unaccountedKg === 0 ? "text-primary" : "text-[var(--signal-amber)]"}`}>
                    {Math.round(derived.balance.unaccountedKg).toLocaleString()} kg
                  </span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-muted-foreground">{t("dash.premium")}</span>
                  <span className="num">{fmtMoney(derived.premium, "USD")}</span>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">{t("dash.noOpenBatches")}</p>
            )}
          </CardContent>
        </Card>

        {/* 4 — needs attention */}
        <Card className="col-span-12 lg:col-span-5">
          <CardContent className="p-0">
            <div className="num px-4 pb-1 pt-3 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{t("home.needsYou")}</div>
            {needs.length === 0 && data && (
              <p className="px-4 pb-4 text-sm text-muted-foreground">{t("home.allQuiet")} {clear.map((c) => c.label).join(" · ")}</p>
            )}
            {needs.map((s) => (
              <Link key={s.label} to={s.to} className="flex items-center gap-3 border-t border-border px-4 py-2.5 hover:bg-accent/40">
                <s.icon className="h-4 w-4 shrink-0 text-[var(--signal-amber)]" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px]">{s.label}</div>
                  <div className="text-[11px] text-muted-foreground">{s.hint}</div>
                </div>
                <div className="num text-lg">{s.value}</div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
            {data?.alerts.slice(0, 4).map((a) => (
              <Link key={a.id} to="/alerts" className="flex items-center gap-3 border-t border-border/60 px-4 py-2 hover:bg-accent/40">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${a.severity === "high" || a.severity === "critical" ? "bg-[var(--signal-red)]" : "bg-[var(--signal-amber)]"}`} />
                <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
                  {alertTypeLabel(a.alert_type)} · {a.farms?.farm_name ?? "—"}
                </span>
                <span className="num text-[11px] text-muted-foreground">{a.detected_date.slice(0, 10)}</span>
              </Link>
            ))}
            {needs.length > 0 && clear.length > 0 && (
              <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">{t("home.restClear")} {clear.map((c) => c.label).join(" · ")}</p>
            )}
          </CardContent>
        </Card>

        {/* 5 — satellite */}
        <Card className="col-span-12 md:col-span-6 lg:col-span-3">
          <CardContent className="p-4">
            <div className="num text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{t("dash.satellite")}</div>
            <dl className="mt-2 space-y-1.5 text-[12px]">
              {[
                { k: t("dash.optical"), v: freshnessLabel(fresh.optical, today), c: "text-primary" },
                { k: t("dash.radar"), v: freshnessLabel(fresh.radar, today), c: "text-[var(--signal-water)]" },
                { k: t("dash.fires"), v: freshnessLabel(fresh.fires, today), c: "text-[var(--signal-amber)]" },
              ].map((r) => (
                <div key={r.k} className="flex justify-between">
                  <dt className={r.c}>{r.k}</dt>
                  <dd className="num">{r.v}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t border-border pt-1.5">
                <dt className="text-muted-foreground">{t("dash.radarPasses")}</dt>
                <dd className="num">{derived?.radarPasses ?? 0}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t("dash.agreement")}</dt>
                <dd className="num">{derived?.agreement.pct === null || derived?.agreement.pct === undefined ? "—" : `${derived.agreement.pct} %`}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t("dash.parcelsStressed")}</dt>
                <dd className="num">{derived?.stressed ?? 0}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t("dash.firesOpen")}</dt>
                <dd className="num">{derived?.fires30 ?? 0}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* 6 — activity */}
        <Card className="col-span-12 md:col-span-6 lg:col-span-4">
          <CardContent className="p-0">
            <div className="num px-4 pb-1 pt-3 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{t("dash.activity")}</div>
            {derived?.activity.length === 0 && <p className="px-4 pb-4 text-sm text-muted-foreground">{t("dash.noData")}</p>}
            {derived?.activity.map((r, i) => (
              <Link key={`${r.kind}-${r.label}-${i}`} to={r.to} className="flex items-center gap-3 border-t border-border/60 px-4 py-1.5 hover:bg-accent/40">
                <span className="num w-[68px] shrink-0 text-[11px] text-muted-foreground">{r.date.slice(5)}</span>
                <span className="tag shrink-0">{t(KIND_KEY[r.kind])}</span>
                <span className="min-w-0 flex-1 truncate text-[12px]">{r.label}</span>
                {r.kg !== null && <span className="num text-[11px] text-muted-foreground">{Math.round(r.kg).toLocaleString()} kg</span>}
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
