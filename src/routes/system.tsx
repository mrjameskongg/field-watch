// /system — public engineering page. No login, no data queries.
//
// The app itself is login-gated, so this page is where an outside reader
// (judge, mentor, buyer, bank) sees HOW the system is built: the ledger
// rules, the conservation checks, and the field-hardening. Every claim on
// this page describes shipped, tested behavior — nothing aspirational.
//
// English only on purpose: the audience is a technical reader, not mill staff.

import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowRight,
  BookLock,
  CircuitBoard,
  CloudOff,
  Eye,
  FlaskConical,
  Landmark,
  Radar,
  Scale,
  ShieldCheck,
} from "lucide-react";

export const Route = createFileRoute("/system")({
  component: SystemPage,
});

const LEDGER_LAWS: { title: string; body: string; where: string }[] = [
  {
    title: "Derived, never stored",
    body: "Stock on hand is computed from the delivery and weigh-point ledger every time you look — there is no balance column anywhere in the database. A number that is never stored can never drift from the records that justify it.",
    where: "Stock page · wet intake, dried in store, and four mill outputs all recomputed live",
  },
  {
    title: "Append-only where money moves",
    body: "Dispatch records cannot be edited — the database itself has no update permission on that table, so the rule holds even against the app's own bugs. A mistake is corrected by a new row, the way a paper ledger is corrected: visibly.",
    where: "Dispatches · enforced at the row-security layer, not in the UI",
  },
  {
    title: "No drafts, no background posting",
    body: "Every record is final the moment it is saved. There is no queue of unposted documents and no overnight job that changes yesterday's numbers — what you see at 9am is what was true at 9am.",
    where: "Everywhere · a deliberate rejection of draft-and-post ERP workflows",
  },
  {
    title: "Events derived, not duplicated",
    body: "The recall ledger (what-when-where-who for every lot) is generated from the operational records themselves — there is no second events table to fall out of sync. The audit trail cannot disagree with the books because it is the books.",
    where: "Recall lookup · lot genealogy runs backward to farmers and forward to buyers",
  },
];

const CONSERVATION: { title: string; body: string }[] = [
  {
    title: "Mass balance on every lot",
    body: "Weigh points across drying and milling must add up. Head rice, broken, bran, husk and wastage are reconciled against what entered the mill, and the unaccounted difference is shown in kilograms — 0 kg on the current demo batch.",
  },
  {
    title: "Over-claim ceilings",
    body: "A lot claiming more than a 75% milling recovery, or a farmer delivering more than 10 tonnes per mapped hectare, trips a warning banner. The system argues back at physically implausible numbers instead of recording them quietly.",
  },
  {
    title: "Contract fulfilment in the open",
    body: "Every delivery lands against a contract's expected quantity, with an expected-vs-delivered bar. Over-delivery warns rather than blocks — the mill still decides, but never unknowingly.",
  },
  {
    title: "Payment gated on measurement",
    body: "A delivery cannot be settled until a moisture test is recorded against it. The gate does not care whether the load passed — wet paddy is still bought — it forces the measurement to exist before money moves.",
  },
];

const FIELD_HARDENING: { title: string; body: string }[] = [
  {
    title: "Offline capture with an outbox",
    body: "Deliveries, tests, weigh points and field logs recorded without signal are queued on the phone and sent when the connection returns. The record is created with a client-side identity, so a retry can never post twice.",
  },
  {
    title: "Two phones can't collide",
    body: "Offline record codes carry a per-device tag, so two field officers working offline in different villages cannot generate the same document number.",
  },
  {
    title: "Payment refuses to queue",
    body: "Settlement is deliberately excluded from the offline queue: paying depends on which loads are already settled, and a stale phone could pay a farmer twice. The one action that moves money requires a live connection — by design.",
  },
  {
    title: "Failure is loud",
    body: "A queued record that cannot be delivered after five attempts stops retrying and tells the user, instead of failing silently forever. Every database error in the app surfaces as a visible message — nothing is swallowed.",
  },
];

const INDEPENDENT_RECORD: string[] = [
  "Every radar pass over a parcel is compared against the nearest farmer-logged water state within six days, and scored: agrees, disagrees, or unconfirmed.",
  "The agreement rate is shown per parcel. Disagreements are surfaced deliberately, never smoothed over — a record that only ever agrees with itself proves nothing.",
  "This is the shape of evidence that water-saving (AWD) verification methodologies ask for: a dated practice log and an independent remote-sensing record of the same field, kept side by side.",
  "The satellite does not wait for anyone. Vegetation, water and fire are recorded from orbit whether or not anything is logged — gaps in the logbook are themselves visible.",
];

const MODULE_GROUPS: { name: string; modules: { name: string; what: string }[] }[] = [
  {
    name: "Field operations",
    modules: [
      { name: "Farmer File", what: "one page per farmer in the mill's own document language — biodata, contracts, advances, deliveries, tests — with a five-dot completeness status on every farmer" },
      { name: "Farms & parcels", what: "GPS capture, click-to-draw boundaries, area auto-measured from the polygon" },
      { name: "Field visits", what: "structured visit logs — crop, water, burn signs, pests — from the officer's phone" },
      { name: "Crop seasons", what: "per-parcel season ledger: water events, fertiliser, yield-gated closing" },
    ],
  },
  {
    name: "Satellite intelligence",
    modules: [
      { name: "Health map", what: "every mapped parcel coloured by live Sentinel-2 NDVI, refreshed on demand" },
      { name: "Radar water watch", what: "Sentinel-1 flooded/drained detection cross-checked against the farmer's log" },
      { name: "Burn watch", what: "NASA FIRMS fire detections matched to parcels, raised as alerts" },
    ],
  },
  {
    name: "Trade & mill",
    modules: [
      { name: "Contracts", what: "expected-vs-delivered bars, advances, printable bilingual agreements, an eight-step chain flow showing exactly where each farmer stands" },
      { name: "Deliveries & QC", what: "farm-gate intake with price autofill, moisture flags, quality tests — and payment gated on a recorded test" },
      { name: "Batches", what: "numbered weigh-point timeline from wet intake to head rice, mass balance reconciled per stage" },
      { name: "Stock & dispatches", what: "on-hand derived live from the ledger; buyer dispatches append-only" },
      { name: "Farmer ranking", what: "composite score from fulfilment, tested quality and clean-farm status" },
    ],
  },
  {
    name: "Compliance & intelligence",
    modules: [
      { name: "Recall lookup", what: "lot genealogy both directions — lot to farmers, farmer to every lot — with over-claim checks" },
      { name: "Evidence packs", what: "per-contract export: parcels, coordinates, volumes, AWD practice with radar agreement" },
      { name: "Reports", what: "portfolio views over farmers, farms, areas, alerts — CSV out" },
      { name: "Ask your mill", what: "staff ask questions in Khmer or English; answers come from their own live records under their own permissions" },
    ],
  },
  {
    name: "Platform",
    modules: [
      { name: "Offline capture", what: "field records queue on the phone and sync back without duplicates" },
      { name: "Bilingual UI", what: "English and Khmer throughout the app" },
      { name: "Phone install", what: "installs to the home screen as a real app window" },
      { name: "Roles & audit", what: "admin, manager and field-officer permissions enforced in the database" },
    ],
  },
];

const SCREENS: { img: string; title: string; caption: string }[] = [
  { img: "map", title: "Zone overview", caption: "the estate from orbit — parcels monitored, hectares under watch, healthy vs stressed, fire detections, live Sentinel imagery" },
  { img: "deliveries", title: "Deliveries", caption: "farm-gate intake with automatic moisture flags — DL-2026-104 caught at 25.2%, marked >24% wet" },
  { img: "farmers", title: "Farmer registry", caption: "the operation guide and farmer files — each farmer carries a five-dot document completeness status" },
  { img: "dashboard", title: "Dashboard", caption: "the mill's morning: wet loads, QC failures, unsettled deliveries, parcels stressed" },
  { img: "contracts", title: "Contracts", caption: "expected-vs-delivered per contract, advances, printable bilingual agreements" },
  { img: "batches", title: "Batches", caption: "each lot from wet intake to head rice, mass balance reconciled" },
  { img: "stock", title: "Stock", caption: "on-hand derived live from the ledger — wet intake, dried in store, four mill outputs" },
  { img: "ranking", title: "Farmer ranking", caption: "composite grades from fulfilment, tested quality and clean-farm status" },
  { img: "recall", title: "Recall lookup", caption: "lot genealogy in both directions with over-claim checks" },
  { img: "compliance", title: "Evidence packs", caption: "per-contract export: parcels, coordinates, volumes, AWD practice with radar agreement" },
  { img: "ask", title: "Ask your mill", caption: "staff ask in Khmer or English; answers come from live records under their own permissions" },
];

const PRIVACY: string[] = [
  "The public trace page is served by a dedicated server function that hand-builds one sanitized object — the database's own access rules are never relaxed for it.",
  "Farm coordinates are rounded to roughly 110 m before they leave the server, and parcel boundaries never leave at all.",
  "Farmers appear by first name and village only. No phone numbers, no ID numbers, no prices, no settlement amounts.",
  "What a buyer can verify and what stays private were decided per field, on purpose — not by exposing tables and hoping.",
];

function SystemPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-2">
          <img src="/brm-agro-logo.png" alt="" className="h-7 w-auto" />
          <span className="font-semibold">BRM Agro</span>
          <span className="text-sm text-muted-foreground">Field Watch · engineering</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CircuitBoard className="h-6 w-6" />
            How Field Watch is engineered
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Field Watch runs a real rice operation: farmer registry, contracts, deliveries, drying, milling, dispatch
            and public traceability. The rules below are not aspirations — each one describes behavior that is shipped,
            enforced and unit-tested today.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BookLock className="h-4 w-4" />
              Ledger laws
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              These rules were learned the hard way, operating a full ERP for a dairy business — every one of them
              exists because its absence has already burned us elsewhere.
            </p>
            {LEDGER_LAWS.map((law, i) => (
              <div key={law.title} className="flex gap-3">
                <span className="h-7 w-7 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
                  {i + 1}
                </span>
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">{law.title}</p>
                  <p className="text-sm text-muted-foreground">{law.body}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Where:</span> {law.where}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Scale className="h-4 w-4" />
              Logic that argues back
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {CONSERVATION.map((c) => (
              <div key={c.title} className="space-y-0.5">
                <p className="text-sm font-medium">{c.title}</p>
                <p className="text-sm text-muted-foreground">{c.body}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Radar className="h-4 w-4" />
              Two independent records of the same field
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {INDEPENDENT_RECORD.map((line) => (
              <p key={line} className="text-sm text-muted-foreground">
                • {line}
              </p>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CloudOff className="h-4 w-4" />
              Hardened for the field, not the demo
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {FIELD_HARDENING.map((f) => (
              <div key={f.title} className="space-y-0.5">
                <p className="text-sm font-medium">{f.title}</p>
                <p className="text-sm text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Privacy by design on the public page
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {PRIVACY.map((line) => (
              <p key={line} className="text-sm text-muted-foreground">
                • {line}
              </p>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FlaskConical className="h-4 w-4" />
              Verification discipline
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            <p className="text-sm text-muted-foreground">
              Every rule above lives in a pure, framework-free logic module with its own unit tests —{" "}
              <span className="font-medium text-foreground">303 tests</span> across 24 suites run before anything
              ships. Mass balance, recall genealogy, ranking, offline queueing and the payment gate are tested code
              paths, not policy documents.
            </p>
            <p className="text-sm text-muted-foreground">
              Row-level security is enforced in the database for every table; reporting views run with invoker rights
              so they cannot leak what the user could not already see.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CircuitBoard className="h-4 w-4" />
              What's inside the full system
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The account-gated application behind this page runs the whole operation — twenty working modules, not a
              landing page:
            </p>
            {MODULE_GROUPS.map((group) => (
              <div key={group.name} className="space-y-1">
                <p className="text-sm font-medium">{group.name}</p>
                {group.modules.map((m) => (
                  <p key={m.name} className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{m.name}</span> — {m.what}
                  </p>
                ))}
              </div>
            ))}
            <div className="border-t pt-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                The app is account-gated because it holds a real operation's records — but a read-only demo account is
                open to anyone. The database itself refuses writes from it, so explore freely.
              </p>
              <Button asChild size="sm" variant="outline">
                <Link to="/login" search={{ demo: 1 }}>
                  Explore the live demo <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="h-4 w-4" />
              The real screens, live data
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Captured from the production system as it runs today — not mock-ups.
            </p>
            {SCREENS.map((s) => (
              <figure key={s.img} className="space-y-1.5">
                <img
                  src={`/screens/${s.img}.png`}
                  alt={s.title}
                  loading="lazy"
                  className="w-full rounded-md border"
                />
                <figcaption className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{s.title}</span> — {s.caption}
                </figcaption>
              </figure>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              See it hold together
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The public trace of batch B26-0001 shows the whole chain at once: four deliveries from three farms,
              measured drying loss, a reconciled mill-out, and the satellite record beside the farmer's log — with 0 kg
              unaccounted.
            </p>
            <Button asChild size="sm">
              <Link to="/trace/$code" params={{ code: "B26-0001" }}>
                Open the public trace <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="font-normal">
            <Landmark className="h-3 w-3 mr-1" />
            Built and operated by BRM Agro, Kampong Thom
          </Badge>
        </div>
      </main>

      <footer className="max-w-2xl mx-auto px-4 py-8 text-xs text-muted-foreground">
        The full application is account-gated. This page and the batch trace pages are public by design.
      </footer>
    </div>
  );
}
