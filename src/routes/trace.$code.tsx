// Public batch trace — the page a buyer reaches by scanning the QR on a batch.
// No login, no AuthGuard: it sits outside /_authenticated and reads only what
// the `trace` edge function chooses to hand out (no phones, IDs, prices, money).
//
// The thing no competitor's trace page has: the satellite record of the actual
// parcels, shown next to what the farmer logged — now with the map to prove it.
//
// The page carries its own EN/Khmer toggle (it renders outside the app shell,
// so it cannot use the authenticated i18n provider). Khmer strings below are
// machine-drafted like the rest of the app — native review pending.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Leaf, MapPin, Satellite, Share2, Sprout } from "lucide-react";
import { batchMath, isEstimated, stageTotals, stageLabel, type WeighPointLite } from "@/lib/batch-core";
import { radarVerdict } from "@/lib/awd-core";
import { TraceMap, type TraceFarmPoint } from "@/components/trace-map";
import { humanize } from "@/lib/labels";

export const Route = createFileRoute("/trace/$code")({
  ssr: false,
  component: TracePage,
});

type TraceData = {
  batch: {
    code: string;
    crop: string;
    custody_model: string;
    created_date: string;
    status: string;
    storage_location: string | null;
    variety: string | null;
    dryer: string | null;
    season: string | null;
  };
  weigh_points: (WeighPointLite & { recorded_date: string })[];
  intake: {
    received_date: string;
    weight_kg: number;
    moisture_pct: number | null;
    grade: string | null;
    farmer: string;
    village: string | null;
  }[];
  farmers: {
    name: string;
    village: string | null;
    province: string | null;
    certifications: string | null;
    hectares: number | null;
    mapped_parcels: number;
    latest_ndvi: number | null;
    latest_ndvi_date: string | null;
    radar_passes: number;
    radar_drained: number;
    radar_series?: {
      date: string;
      vv_db: number;
      vh_db: number;
      state: "flooded" | "drained" | "uncertain";
      confidence: { score: number; grade: "high" | "medium" | "low" };
      rain: { label: "managed_dry" | "rain_possible" | "neutral" | "no_data"; rain72h: number | null };
    }[];
    ndvi_series?: { date: string; ndvi: number | null }[];
    dry_spells?: number;
    log_agreement?: { decisive: number; agreed: number; rate: number | null };
    delivered_kg: number;
  }[];
  qc_tests: {
    test_type: string;
    result_value: number | null;
    result_text: string | null;
    passed: boolean | null;
    tested_date: string;
  }[];
  burn_alerts: number;
  farm_points?: TraceFarmPoint[];
  methodology?: {
    radar: string;
    optical: string;
    rain: string;
    flooded_vv_db: number;
    drained_vv_db: number;
    canopy_vh_db: number;
  };
};

type Lang = "en" | "km";

const STR = {
  brandTag: { en: "Rice traceability", km: "ការតាមដានស្រូវអង្ករ" },
  journey: { en: "Journey", km: "ដំណើររបស់ស្រូវ" },
  whereItGrew: { en: "Where it grew", km: "កន្លែងដែលស្រូវដុះ" },
  locationsApprox: { en: "Farm locations are approximate.", km: "ទីតាំងកសិដ្ឋានប្រហាក់ប្រហែល។" },
  fieldToRice: { en: "From field to rice", km: "ពីស្រែដល់អង្ករ" },
  received: { en: "Received", km: "ទទួលបាន" },
  driedTo: { en: "Dried to", km: "សម្ងួតដល់" },
  dryingLoss: { en: "Drying loss", km: "បាត់បង់ពេលសម្ងួត" },
  millingRecovery: { en: "Milling recovery", km: "អត្រាកិន" },
  moisture: { en: "moisture", km: "សំណើម" },
  farmBehindOne: { en: "The farm behind this batch", km: "កសិដ្ឋាននៅពីក្រោយឡូតិ៍នេះ" },
  farmBehindMany: { en: "The farms behind this batch", km: "កសិដ្ឋាននៅពីក្រោយឡូតិ៍នេះ" },
  intoBatch: { en: "into this batch", km: "ចូលក្នុងឡូតិ៍នេះ" },
  haFarmed: { en: "ha farmed", km: "ហិកតា" },
  qualityTests: { en: "Quality tests", km: "តេស្តគុណភាព" },
  pass: { en: "Pass", km: "ជាប់" },
  fail: { en: "Fail", km: "ធ្លាក់" },
  pending: { en: "Pending", km: "រង់ចាំ" },
  packed: { en: "packed", km: "វេចខ្ចប់" },
  singleFarm: { en: "single farm, never mixed", km: "កសិដ្ឋានតែមួយ មិនលាយ" },
  mixedLot: { en: "mixed lot", km: "ឡូតិ៍លាយ" },
  about: { en: "≈ estimated from bag counts, not weighed", km: "≈ ប៉ាន់ស្មានពីចំនួនបាវ មិនបានថ្លឹង" },
  share: { en: "Share", km: "ចែករំលែក" },
  copied: { en: "Copied", km: "បានចម្លង" },
  noSteps: { en: "No steps recorded yet.", km: "មិនទាន់មានកំណត់ត្រាទេ។" },
  noFarms: { en: "No farm records attached.", km: "មិនមានកំណត់ត្រាកសិដ្ឋានទេ។" },
  harvestFrom: { en: "Harvest received from", km: "ទទួលស្រូវពី" },
  cropVigour: { en: "Crop vigour", km: "កម្លាំងដំណាំ" },
  parcelsMapped: { en: "mapped by satellite", km: "គូសផែនទីដោយផ្កាយរណប" },
  radarLine1: { en: "Radar checked the field", km: "រ៉ាដាបានពិនិត្យស្រែ" },
  radarLine2: { en: "times · drained on", km: "ដង · ស្ងួត" },
  satPara: {
    en: "Vegetation readings come from the European Space Agency's Sentinel-2 satellite and field-water readings from Sentinel-1 radar, taken over the mapped parcel — an independent record alongside what the farmer logged.",
    km: "ការវាស់រុក្ខជាតិបានមកពីផ្កាយរណប Sentinel-2 របស់ទីភ្នាក់ងារអវកាសអឺរ៉ុប និងទឹកក្នុងស្រែពីរ៉ាដា Sentinel-1 — ជាកំណត់ត្រាឯករាជ្យក្បែរអ្វីដែលកសិករបានកត់ត្រា។",
  },
  noBurn: {
    en: "No burning was detected on these fields by NASA's fire satellites.",
    km: "ផ្កាយរណបភ្លើងរបស់ NASA មិនបានរកឃើញការដុតនៅលើស្រែទាំងនេះទេ។",
  },
  footer: {
    en: "Records kept in BRM Agro Field Watch. Personal details of farmers are not shown on this page.",
    km: "កំណត់ត្រារក្សាទុកក្នុង BRM Agro Field Watch។ ព័ត៌មានផ្ទាល់ខ្លួនរបស់កសិករមិនបង្ហាញនៅទីនេះទេ។",
  },
  notFound: { en: "Nothing found for this code.", km: "រកមិនឃើញកូដនេះទេ។" },
  codeScanned: { en: "Code scanned:", km: "កូដដែលបានស្កេន៖" },
  satEvidence: { en: "Radar water record", km: "កំណត់ត្រាទឹកពីរ៉ាដា" },
  drySpell: { en: "dry spell observed", km: "ចន្លោះស្ងួតដែលឃើញ" },
  drySpells: { en: "dry spells observed", km: "ចន្លោះស្ងួតដែលឃើញ" },
  logAgreement: { en: "matched the field log", km: "ត្រូវគ្នានឹងកំណត់ត្រាកសិករ" },
  latestPass: { en: "Latest pass", km: "ជើងហោះចុងក្រោយ" },
  verdictDryAll: { en: "Dry on every decisive pass since", km: "ស្ងួតគ្រប់ជើងហោះច្បាស់លាស់ចាប់តាំងពី" },
  verdictDryAllTail: { en: "— consistent with a drained field after harvest.", km: "— ស្របនឹងស្រែដែលបានបង្ហូរទឹកក្រោយប្រមូលផល។" },
  verdictFlooded: { en: "Flooded on the latest pass", km: "លិចទឹកនៅជើងហោះចុងក្រោយ" },
  verdictFloodedTail: { en: "— standing water on the field right now.", km: "— មានទឹកដក់នៅលើស្រែនាពេលនេះ។" },
  verdictDried: { en: "Dried down after flooding", km: "បានរីងក្រោយពីលិចទឹក" },
  verdictDriedTail: { en: "— the wet-and-dry pattern buyers look for.", km: "— លំនាំសើម-ស្ងួតដែលអ្នកទិញចង់ឃើញ។" },
  verdictOf: { en: "of", km: "នៃ" },
  verdictPasses: { en: "passes dry", km: "ជើងហោះស្ងួត" },
  managedDry: { en: "no significant rain in the prior 72 h — managed drying", km: "គ្មានភ្លៀងធំក្នុង ៧២ ម៉ោងមុន — ការសម្ងួតដោយចេតនា" },
  rainPossible: { en: "heavy rain nearby — may be weather, not management", km: "មានភ្លៀងធំនៅជិត — អាចជាអាកាសធាតុ" },
  confHigh: { en: "high confidence", km: "ទំនុកចិត្តខ្ពស់" },
  confMedium: { en: "medium confidence", km: "ទំនុកចិត្តមធ្យម" },
  confLow: { en: "low confidence", km: "ទំនុកចិត្តទាប" },
  flooded: { en: "flooded", km: "លិចទឹក" },
  drained: { en: "drained", km: "ស្ងួត" },
  uncertain: { en: "uncertain", km: "មិនច្បាស់" },
  auditNote: {
    en: "Every radar decibel value is published above so anyone can re-check every call: flooded ≤ −15 dB, drained ≥ −10 dB, in between reported as uncertain. Calls under a closed canopy are down-weighted, and rainfall from an independent weather archive is shown next to each drying event.",
    km: "តម្លៃរ៉ាដាដើមបង្ហាញខាងលើ ដើម្បីឱ្យនរណាក៏អាចផ្ទៀងផ្ទាត់បាន៖ លិចទឹក ≤ −15 dB ស្ងួត ≥ −10 dB ចន្លោះ = មិនច្បាស់។ ការវាស់ក្រោមស្លឹកស្រូវក្រាស់ត្រូវបានទម្លាក់ទម្ងន់ ហើយទិន្នន័យភ្លៀងឯករាជ្យបង្ហាញក្បែរការសម្ងួតនីមួយៗ។",
  },
} as const;

const STAGE_KM: Record<string, string> = {
  received: "ទទួល (សើម)",
  pre_dried: "ក្រោយសម្ងួតដំណាក់កាលដំបូង",
  post_drying: "ក្រោយសម្ងួត",
  into_storage: "ចូលឃ្លាំង (បាវធំ)",
  into_mill: "ចូលម៉ាស៊ីនកិន",
  milled_output: "អង្ករគ្រាប់ល្អ",
  broken: "អង្ករកំទេច",
  bran: "កន្ទក់",
  husk: "អង្កាម",
  wastage: "ខាតបង់",
  other: "ផ្សេងៗ",
};

// Output segments of the mass-balance bar, in milling order.
const BALANCE_SEGMENTS: { stage: string; color: string }[] = [
  { stage: "milled_output", color: "bg-primary" },
  { stage: "broken", color: "bg-amber-500" },
  { stage: "bran", color: "bg-orange-400" },
  { stage: "husk", color: "bg-stone-400" },
  { stage: "wastage", color: "bg-red-400" },
];

const fmtKg = (n: number) => `${n.toLocaleString()} kg`;

const STATE_COLOR: Record<string, string> = {
  flooded: "#0284c7", // water — sky-600
  drained: "#d97706", // dry — amber-600
  uncertain: "#a8a29e", // stone-400
};

/** Raw VV backscatter per pass with the decision thresholds drawn in. The
 *  point of this chart is auditability: the classifier's inputs are public. */
function RadarChart({ series }: {
  series: NonNullable<TraceData["farmers"][number]["radar_series"]>;
}) {
  if (series.length === 0) return null;
  const W = 320, H = 104, PAD_L = 30, PAD_R = 6, PAD_T = 8, PAD_B = 16;
  const yMin = -24, yMax = -4; // dB range wide enough for paddy signals
  const x = (i: number) =>
    PAD_L + (series.length === 1 ? 0 : (i * (W - PAD_L - PAD_R)) / (series.length - 1));
  const y = (db: number) =>
    PAD_T + ((yMax - Math.max(yMin, Math.min(yMax, db))) * (H - PAD_T - PAD_B)) / (yMax - yMin);
  const line = series.map((r, i) => `${x(i).toFixed(1)},${y(r.vv_db).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-md" role="img"
      aria-label="Radar backscatter per satellite pass with flooded and drained thresholds">
      {/* drained zone: above -10 dB */}
      <rect x={PAD_L} y={PAD_T} width={W - PAD_L - PAD_R} height={y(-10) - PAD_T} fill="#d97706" opacity="0.07" />
      {/* flooded zone: below -15 dB */}
      <rect x={PAD_L} y={y(-15)} width={W - PAD_L - PAD_R} height={H - PAD_B - y(-15)} fill="#0284c7" opacity="0.07" />
      <line x1={PAD_L} x2={W - PAD_R} y1={y(-10)} y2={y(-10)} stroke="#d97706" strokeDasharray="3 3" strokeWidth="1" opacity="0.5" />
      <line x1={PAD_L} x2={W - PAD_R} y1={y(-15)} y2={y(-15)} stroke="#0284c7" strokeDasharray="3 3" strokeWidth="1" opacity="0.5" />
      <text x={2} y={y(-10) + 3} fontSize="8" fill="#d97706">−10 dB</text>
      <text x={2} y={y(-15) + 3} fontSize="8" fill="#0284c7">−15 dB</text>
      <polyline points={line} fill="none" stroke="#78716c" strokeWidth="1" opacity="0.55" />
      {series.map((r, i) => (
        <circle key={`${r.date}-${i}`} cx={x(i)} cy={y(r.vv_db)}
          r={r.confidence.grade === "high" ? 3.4 : r.confidence.grade === "medium" ? 2.7 : 2}
          fill={STATE_COLOR[r.state]}
          opacity={r.confidence.grade === "low" ? 0.55 : 1}>
          <title>{`${r.date} · VV ${r.vv_db} dB · ${r.state} (${r.confidence.grade})`}</title>
        </circle>
      ))}
      <text x={PAD_L} y={H - 4} fontSize="8" fill="#78716c">{series[0].date}</text>
      <text x={W - PAD_R} y={H - 4} fontSize="8" fill="#78716c" textAnchor="end">{series[series.length - 1].date}</text>
    </svg>
  );
}

/** Six optical readings as a sparkline — a trend, not a lone number. */
function NdviSpark({ series }: { series: { date: string; ndvi: number | null }[] }) {
  const pts = series.filter((r) => r.ndvi !== null) as { date: string; ndvi: number }[];
  if (pts.length < 2) return null;
  const W = 64, H = 18;
  const x = (i: number) => (i * (W - 4)) / (pts.length - 1) + 2;
  const y = (v: number) => H - 2 - Math.max(0, Math.min(1, v)) * (H - 4);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="inline-block h-[18px] w-16 align-middle" role="img"
      aria-label="Crop vigour trend">
      <polyline points={pts.map((r, i) => `${x(i)},${y(r.ndvi)}`).join(" ")}
        fill="none" stroke="#16a34a" strokeWidth="1.4" />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1].ndvi)} r="2" fill="#16a34a" />
    </svg>
  );
}

function TracePage() {
  const { code } = Route.useParams();
  const [data, setData] = useState<TraceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState<Lang>("en");
  const [shared, setShared] = useState(false);
  const s = (k: keyof typeof STR) => STR[k][lang];
  const stageName = (stage: string) => (lang === "km" ? (STAGE_KM[stage] ?? stageLabel(stage)) : stageLabel(stage));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: res, error: err } = await supabase.functions.invoke("trace", { body: { code } });
      if (cancelled) return;
      setLoading(false);
      if (err) {
        // invoke() masks the real message; it is only in the response body.
        let message = "This code could not be checked. Try again in a moment.";
        const ctx = (err as { context?: Response }).context;
        if (ctx) {
          try {
            const body = await ctx.json();
            if (body?.error) message = body.error;
          } catch {
            /* keep the generic message */
          }
        }
        setError(message);
        return;
      }
      setData(res as TraceData);
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: `BRM Agro · ${code}`, url });
        return;
      }
    } catch {
      /* user cancelled the share sheet — fall through to nothing */
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 1500);
    } catch {
      /* clipboard unavailable — button just does nothing rather than lying */
    }
  };

  const langToggle = (
    <div className="ml-auto flex items-center gap-1 text-sm">
      <button
        className={`px-1.5 py-0.5 rounded ${lang === "en" ? "font-semibold" : "text-muted-foreground"}`}
        onClick={() => setLang("en")}
      >
        EN
      </button>
      <span className="text-muted-foreground">·</span>
      <button
        className={`px-1.5 py-0.5 rounded ${lang === "km" ? "font-semibold" : "text-muted-foreground"}`}
        onClick={() => setLang("km")}
      >
        ខ្មែរ
      </button>
    </div>
  );

  if (loading) {
    return (
      <Shell tag={s("brandTag")} extra={langToggle} footer={s("footer")}>
        <div className="space-y-4 animate-pulse">
          <div className="h-9 w-48 rounded bg-muted" />
          <div className="h-4 w-72 rounded bg-muted" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-lg bg-muted" />
            ))}
          </div>
          <div className="h-56 rounded-lg bg-muted" />
          <div className="h-72 rounded-lg bg-muted" />
        </div>
      </Shell>
    );
  }

  if (error || !data) {
    return (
      <Shell tag={s("brandTag")} extra={langToggle} footer={s("footer")}>
        <Card>
          <CardContent className="py-8 text-center space-y-1">
            <p className="font-medium">{error ?? s("notFound")}</p>
            <p className="text-sm text-muted-foreground">
              {s("codeScanned")} {code}
            </p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  const math = batchMath(data.weigh_points);
  const totals = stageTotals(data.weigh_points);
  const balance = BALANCE_SEGMENTS.map((b) => ({ ...b, kg: totals[b.stage] ?? 0 })).filter((b) => b.kg > 0);
  const balanceTotal = balance.reduce((sum, b) => sum + b.kg, 0);
  const points = data.farm_points ?? [];

  const steps = [
    ...data.intake.map((i) => ({
      key: `in-${i.received_date}-${i.farmer}-${i.weight_kg}`,
      date: i.received_date,
      title: `${s("harvestFrom")} ${i.farmer}`,
      detail: `${fmtKg(i.weight_kg)}${i.village ? ` · ${i.village}` : ""}${i.grade ? ` · grade ${i.grade}` : ""}`,
      moisture: i.moisture_pct,
      farm: true,
    })),
    ...data.weigh_points.map((p, idx) => ({
      key: `wp-${idx}`,
      date: p.recorded_date,
      title: stageName(p.stage),
      detail: `${p.estimated ? "≈ " : ""}${fmtKg(p.weight_kg)}`,
      moisture: p.moisture_pct,
      farm: false,
    })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.farm === b.farm ? 0 : a.farm ? -1 : 1));

  return (
    <Shell tag={s("brandTag")} extra={langToggle} footer={s("footer")}>
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-3xl font-bold">{data.batch.code}</h1>
          <Badge variant="outline">
            {humanize(data.batch.status)}
          </Badge>
          <Button variant="outline" size="sm" className="ml-auto gap-1.5" onClick={share}>
            {shared ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
            {shared ? s("copied") : s("share")}
          </Button>
        </div>
        <p className="text-muted-foreground">
          <span className="capitalize">{data.batch.crop}</span>
          {data.batch.variety ? ` · ${data.batch.variety}` : ""}
          {data.batch.season ? ` · ${data.batch.season}` : ""} · {s("packed")} {data.batch.created_date}
          {data.batch.custody_model === "identity_preserved" ? ` · ${s("singleFarm")}` : ` · ${s("mixedLot")}`}
        </p>
      </div>

      {(math.dryingLossPct !== null || math.millingRecoveryPct !== null) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: s("received"),
              value: data.weigh_points.length ? fmtKg(data.intake.reduce((sum, i) => sum + i.weight_kg, 0)) : "—",
            },
            {
              label: s("driedTo"),
              value: math.moistureAfterDrying !== null ? `${math.moistureAfterDrying}% ${s("moisture")}` : "—",
            },
            {
              label: s("dryingLoss"),
              value: math.dryingLossPct !== null ? `${isEstimated(math, "received", "post_drying") ? "≈ " : ""}${math.dryingLossPct}%` : "—",
            },
            {
              label: s("millingRecovery"),
              value:
                math.millingRecoveryPct !== null ? `${isEstimated(math, "into_mill", "milled_output") ? "≈ " : ""}${math.millingRecoveryPct}%` : "—",
            },
          ].map((stat) => (
            <Card key={stat.label}>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className="text-sm font-semibold tabular-nums">{stat.value}</p>
              </CardContent>
            </Card>
          ))}
          {math.estimatedStages.length > 0 && (
            <p className="col-span-2 sm:col-span-4 text-xs text-muted-foreground">{s("about")}</p>
          )}
        </div>
      )}

      {points.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              {s("whereItGrew")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <TraceMap points={points} />
            <p className="text-xs text-muted-foreground">{s("locationsApprox")}</p>
          </CardContent>
        </Card>
      )}

      {balance.length >= 2 && balanceTotal > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{s("fieldToRice")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex h-4 w-full overflow-hidden rounded-full">
              {balance.map((b) => (
                <div key={b.stage} className={b.color} style={{ width: `${(b.kg / balanceTotal) * 100}%` }} />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {balance.map((b) => (
                <span key={b.stage} className="flex items-center gap-1.5">
                  <span className={`h-2.5 w-2.5 rounded-sm ${b.color}`} />
                  {stageName(b.stage)} · {fmtKg(b.kg)} ({((b.kg / balanceTotal) * 100).toFixed(1)}%)
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{s("journey")}</CardTitle>
        </CardHeader>
        <CardContent>
          {steps.length === 0 && <p className="text-sm text-muted-foreground">{s("noSteps")}</p>}
          <ol>
            {steps.map((step, i) => (
              <li key={step.key} className="relative flex gap-3 pb-5 last:pb-0">
                {i < steps.length - 1 && <span className="absolute left-[13px] top-7 bottom-0 w-px bg-border" />}
                <span
                  className={`h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold ${
                    step.farm ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{step.title}</span>
                    {step.moisture !== null && (
                      <Badge variant="outline" className="font-normal">
                        {lang === "km" ? `${s("moisture")} ${step.moisture}%` : `${step.moisture}% ${s("moisture")}`}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {step.date} · {step.detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sprout className="h-4 w-4" />
            {data.farmers.length === 1 ? s("farmBehindOne") : s("farmBehindMany")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.farmers.length === 0 && <p className="text-sm text-muted-foreground">{s("noFarms")}</p>}
          {data.farmers.map((f) => (
            <div key={`${f.name}-${f.village}`} className="space-y-1.5">
              <p className="font-medium">
                {f.name}
                {f.village ? ` · ${f.village}` : ""}
                {f.province ? `, ${f.province}` : ""}
              </p>
              <p className="text-sm text-muted-foreground">
                {fmtKg(f.delivered_kg)} {s("intoBatch")}
                {f.hectares ? ` · ${f.hectares.toLocaleString()} ${s("haFarmed")}` : ""}
                {f.certifications ? ` · ${f.certifications}` : ""}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {f.mapped_parcels > 0 && (
                  <Badge variant="secondary" className="font-normal gap-1">
                    <Satellite className="h-3 w-3" />
                    {f.mapped_parcels} {s("parcelsMapped")}
                  </Badge>
                )}
                {f.latest_ndvi !== null && (
                  <Badge variant="secondary" className="font-normal gap-1">
                    <Leaf className="h-3 w-3" />
                    {s("cropVigour")} {f.latest_ndvi.toFixed(2)}
                    {f.latest_ndvi_date ? ` · ${f.latest_ndvi_date}` : ""}
                    {f.ndvi_series && <NdviSpark series={f.ndvi_series} />}
                  </Badge>
                )}
                {f.radar_passes > 0 && (
                  <Badge variant="secondary" className="font-normal">
                    {s("radarLine1")} {f.radar_passes} {s("radarLine2")} {f.radar_drained}
                  </Badge>
                )}
              </div>
              {f.radar_series && f.radar_series.length > 0 && (
                <div className="rounded-md border bg-muted/30 p-2.5 space-y-1.5">
                  <p className="text-xs font-medium flex items-center gap-1">
                    <Satellite className="h-3 w-3" />
                    {s("satEvidence")}
                    {typeof f.dry_spells === "number" && f.dry_spells > 0 && (
                      <span className="text-muted-foreground font-normal">
                        · {f.dry_spells} {s(f.dry_spells === 1 ? "drySpell" : "drySpells")}
                      </span>
                    )}
                  </p>
                  <RadarChart series={f.radar_series} />
                  {(() => {
                    const v = radarVerdict(f.radar_series);
                    if (v.key === "none") return null;
                    const head = v.key === "dry-all" ? `${s("verdictDryAll")} ${v.since}` : v.key === "flooded-now" ? s("verdictFlooded") : s("verdictDried");
                    const tail = v.key === "dry-all" ? s("verdictDryAllTail") : v.key === "flooded-now" ? s("verdictFloodedTail") : s("verdictDriedTail");
                    return (
                      <p className="text-xs">
                        <span className="font-medium">{head}</span>{" "}
                        <span className="text-muted-foreground">({v.dry} {s("verdictOf")} {v.decisive} {s("verdictPasses")}) {tail}</span>
                      </p>
                    );
                  })()}
                  {(() => {
                    const last = f.radar_series[f.radar_series.length - 1];
                    const conf = last.confidence.grade === "high" ? s("confHigh")
                      : last.confidence.grade === "medium" ? s("confMedium") : s("confLow");
                    return (
                      <p className="text-xs text-muted-foreground">
                        {s("latestPass")} {last.date} · VV {last.vv_db} dB ·{" "}
                        <span style={{ color: STATE_COLOR[last.state] }} className="font-medium">
                          {s(last.state)}
                        </span>{" "}
                        ({conf})
                        {last.state === "drained" && last.rain.label === "managed_dry" &&
                          ` — ${s("managedDry")}${last.rain.rain72h !== null ? ` (${last.rain.rain72h} mm)` : ""}`}
                        {last.state === "flooded" && last.rain.label === "rain_possible" &&
                          ` — ${s("rainPossible")}${last.rain.rain72h !== null ? ` (${last.rain.rain72h} mm)` : ""}`}
                      </p>
                    );
                  })()}
                  {f.log_agreement && f.log_agreement.decisive > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {f.log_agreement.agreed}/{f.log_agreement.decisive} {s("logAgreement")}
                      {f.log_agreement.rate !== null ? ` (${f.log_agreement.rate}%)` : ""}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
          <p className="text-xs text-muted-foreground border-t pt-3">
            {s("satPara")}{" "}
            {data.burn_alerts === 0
              ? s("noBurn")
              : `NASA fire satellites flagged ${data.burn_alerts} possible burn${data.burn_alerts === 1 ? "" : "s"} near these fields.`}
          </p>
          {data.methodology && data.farmers.some((f) => (f.radar_series?.length ?? 0) > 0) && (
            <p className="text-xs text-muted-foreground">{s("auditNote")}</p>
          )}
        </CardContent>
      </Card>

      {data.qc_tests.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{s("qualityTests")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {data.qc_tests.map((q, i) => (
              <div key={i} className="flex items-center gap-2 text-sm border-b last:border-b-0 py-1.5">
                <span className="flex-1">{humanize(q.test_type)}</span>
                <span className="text-muted-foreground tabular-nums">
                  {q.result_value !== null ? q.result_value : (q.result_text ?? "—")}
                </span>
                <Badge variant={q.passed === false ? "destructive" : "secondary"} className="font-normal">
                  {q.passed === null ? s("pending") : q.passed ? s("pass") : s("fail")}
                </Badge>
                <span className="text-xs text-muted-foreground">{q.tested_date}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </Shell>
  );
}

function Shell({
  children,
  tag,
  extra,
  footer,
}: {
  children: React.ReactNode;
  tag: string;
  extra?: React.ReactNode;
  footer: string;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-2">
          <img src="/brm-agro-logo.png" alt="" className="h-7 w-auto" />
          <span className="font-semibold">BRM Agro</span>
          <span className="text-muted-foreground text-sm ml-3 hidden sm:inline">{tag}</span>
          {extra}
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">{children}</main>
      <footer className="max-w-2xl mx-auto px-4 py-8 text-xs text-muted-foreground space-y-1">
        <p>{footer}</p>
        <p>
          <Link to="/system" className="underline">
            How this system is engineered
          </Link>
        </p>
      </footer>
    </div>
  );
}
