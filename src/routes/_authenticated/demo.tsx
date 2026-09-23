// Present / Demo — the presenter's companion page.
//
// Three jobs: (1) the 60-second live-demo route with what to click and what
// to say at each stop, (2) the satellite-credibility explainer (where every
// reading comes from and why nobody can argue with it), (3) who this system
// serves beyond the mill — ministries, funders, banks, buyers.
//
// English only on purpose: the presenter is the audience here. Facts follow
// the deck's FACT-CHECK discipline — no EUDR (does not cover rice), no
// invented programme names, satellite specs as published by ESA/NASA.

import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowRight,
  Banknote,
  Building2,
  Clock,
  Flame,
  Landmark,
  Leaf,
  MessageCircleQuestion,
  PlayCircle,
  Radar,
  Satellite,
  ShieldCheck,
  Sprout,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/demo")({
  component: DemoPage,
});

const DEMO_STOPS: {
  title: string;
  url: string;
  click: string;
  say: string;
  seconds: number;
}[] = [
  {
    title: "Dashboard",
    url: "/dashboard",
    click: "Point at the Needs-attention cards (wet loads, QC failures, unsettled deliveries).",
    say: "This is a working mill's morning: what needs drying, what failed the lab, who hasn't been paid. Not a mock-up — live data.",
    seconds: 10,
  },
  {
    title: "Map",
    url: "/map",
    click: "Hover a coloured parcel. If asked, press Refresh health — it pulls ESA data live on stage.",
    say: "Every parcel is watched from orbit. Green is healthy vegetation, red is stress. One of our fields reads 0.28 right now — the satellite flagged it before anyone called.",
    seconds: 15,
  },
  {
    title: "Batch",
    url: "/batches",
    click: "Open batch B26-0001.",
    say: "22.8 tonnes of wet paddy from three farms, dried, milled: every kilo accounted for — 62% head rice, and the losses are numbers, not guesses.",
    seconds: 10,
  },
  {
    title: "Trace page",
    url: "/batches",
    click: "Let a judge scan the QR — fieldwatch.live/trace/B26-0001 opens on THEIR phone, no login.",
    say: "This is what a buyer sees: the farms, the journey, and the satellite record next to what the farmer logged. Scroll to a farm: we publish the RAW radar decibels per pass with the thresholds drawn on the chart, the system's own confidence per reading, and independent rainfall next to each drying event. We don't ask for belief — we hand over the evidence. Proof, not storytelling.",
    seconds: 15,
  },
  {
    title: "Ask your mill",
    url: "/ask",
    click: "Tap the Khmer suggestion chip and let it answer.",
    say: "Staff ask in Khmer or English and the answer comes from their own live data — nothing invented, no SQL, no spreadsheets.",
    seconds: 10,
  },
];

const SOURCES: {
  icon: typeof Satellite;
  name: string;
  who: string;
  what: string;
  cadence: string;
}[] = [
  {
    icon: Leaf,
    name: "Sentinel-2 (optical)",
    who: "European Space Agency · Copernicus programme",
    what: "Vegetation vigour (NDVI) and moisture index over each mapped parcel, at 10 m resolution.",
    cadence: "Revisits roughly every 5 days · free and open public data",
  },
  {
    icon: Radar,
    name: "Sentinel-1 (radar)",
    who: "European Space Agency · Copernicus programme",
    what: "C-band radar sees through cloud and at night — it tells a flooded field from a drained one, which is the evidence trail for water-saving (AWD) practice.",
    cadence: "All-weather passes · free and open public data",
  },
  {
    icon: Flame,
    name: "NASA FIRMS (fire)",
    who: "NASA · VIIRS active-fire detection",
    what: "Satellite fire detections near our parcels — the record that shows no stubble burning on these fields.",
    cadence: "Detections published within hours of the pass",
  },
];

const CREDIBILITY: string[] = [
  "Independent by construction: the readings are made by ESA and NASA spacecraft, not by us. The farm cannot edit a satellite pass.",
  "Same sources governments and carbon-market verifiers already use for agricultural monitoring — we are reading the public record, not a private sensor.",
  "Every reading is dated and tied to a mapped parcel, so the record next to the farmer's logbook is checkable line by line.",
  "Data cost: zero. Copernicus and FIRMS are open public programmes — the system scales without buying imagery.",
];

const AUDIENCES: {
  icon: typeof Landmark;
  who: string;
  why: string;
}[] = [
  {
    icon: Landmark,
    who: "MAFF — Ministry of Agriculture, Forestry and Fisheries",
    why: "A live registry of farmers, parcels and practices with satellite verification — the field-level visibility national programmes ask for, already running.",
  },
  {
    icon: Building2,
    who: "MPTC and the digital-economy agenda",
    why: "Khmer-first agricultural software built and run in Cambodia — exactly the digitisation-of-agriculture story the ministry backs (it backs this accelerator).",
  },
  {
    icon: Leaf,
    who: "Ministry of Environment · climate & carbon (MRV)",
    why: "Radar-verified dry-spell records are AWD water-management evidence. AWD cuts paddy methane, and methane cuts are what rice carbon methodologies pay for — Field Watch produces the measurement half of MRV as a by-product of daily work.",
  },
  {
    icon: ShieldCheck,
    who: "Ministry of Commerce · CRF · export buyers",
    why: "Batch-level traceability with quality tests and a public proof page per lot — what premium buyers and certification audits ask Cambodian millers to show, answered with a QR.",
  },
  {
    icon: Banknote,
    who: "Banks and MFIs lending to farmers",
    why: "A farmer with seasons of verified yields, deliveries and satellite-confirmed practice has a credit file where none existed. That record is the collateral substitute rural lending is missing.",
  },
];

function DemoPage() {
  const totalSeconds = DEMO_STOPS.reduce((sum, stop) => sum + stop.seconds, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <PlayCircle className="h-6 w-6" />
          Present Field Watch
        </h1>
        <p className="text-sm text-muted-foreground">
          The live-demo route, the satellite credibility story, and who this system serves. Presenter notes — this page
          is for the person holding the phone. For outside readers without an account, share the public{" "}
          <Link to="/system" className="underline">
            engineering page
          </Link>{" "}
          instead.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            The {totalSeconds}-second demo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {DEMO_STOPS.map((stop, i) => (
            <div key={stop.title} className="flex gap-3">
              <span className="h-7 w-7 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{stop.title}</span>
                  <Badge variant="outline" className="font-normal">
                    ~{stop.seconds}s
                  </Badge>
                  <Button asChild variant="ghost" size="sm" className="h-6 px-2 text-xs ml-auto">
                    <Link to={stop.url}>
                      open <ArrowRight className="h-3 w-3 ml-1" />
                    </Link>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Do:</span> {stop.click}
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Say:</span> “{stop.say}”
                </p>
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground border-t pt-3">
            Rehearse it twice before judging. Bring your own hotspot; the trace page is the stop that happens on the
            judge's phone, not yours.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Satellite className="h-4 w-4" />
            Where the satellite data comes from
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {SOURCES.map((src) => (
            <div key={src.name} className="flex gap-3">
              <src.icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium">{src.name}</p>
                <p className="text-xs text-muted-foreground">{src.who}</p>
                <p className="text-sm">{src.what}</p>
                <p className="text-xs text-muted-foreground">{src.cadence}</p>
              </div>
            </div>
          ))}
          <div className="border-t pt-3 space-y-1.5">
            <p className="text-sm font-medium">Why it's credible</p>
            {CREDIBILITY.map((line) => (
              <p key={line} className="text-sm text-muted-foreground">
                • {line}
              </p>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sprout className="h-4 w-4" />
            Who this serves beyond the mill
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {AUDIENCES.map((a) => (
            <div key={a.who} className="flex gap-3">
              <a.icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium">{a.who}</p>
                <p className="text-sm text-muted-foreground">{a.why}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageCircleQuestion className="h-4 w-4" />
            Questions judges actually ask
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            {
              q: "What does the satellite data cost you?",
              a: "Nothing. Copernicus and FIRMS are open public programmes. Our marginal cost per parcel is effectively zero, which is why this scales to smallholders.",
            },
            {
              q: "Who are the users today?",
              a: "BRM Agro's own operation — our agronomists and contract farmers. First customer is captive; the product earns its way out from there. No invented traction.",
            },
            {
              q: "Why won't farmers just not log things?",
              a: "The satellite record doesn't wait for anyone. Vegetation, water and fire are recorded from orbit either way — the logbook and the sky have to agree, and gaps are visible.",
            },
            {
              q: "What's AI about this?",
              a: "The whole system was built AI-assisted by one operator, and 'Ask your mill' answers staff questions in Khmer or English from their own live data under their own permissions.",
            },
            {
              q: "Does it work offline?",
              a: "Yes — deliveries, tests, weigh points and field logs queue on the phone and sync when signal returns, with duplicate-proof record identities. Settlement deliberately refuses to queue so a stale phone can never pay a farmer twice.",
            },
          ].map((item) => (
            <div key={item.q} className="space-y-0.5">
              <p className="text-sm font-medium">{item.q}</p>
              <p className="text-sm text-muted-foreground">{item.a}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
