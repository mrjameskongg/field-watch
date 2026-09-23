// /tour — the guided demo path. Demo logins land here instead of the raw
// dashboard: five stops, written for someone who has never seen a rice mill.
// Each stop is one plain sentence, one "why money cares" line, and a button
// into the real screen. No mill vocabulary without an explanation.

import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, Banknote, Compass } from "lucide-react";

export const Route = createFileRoute("/_authenticated/tour")({
  component: TourPage,
});

const STOPS: {
  n: number;
  title: string;
  plain: string;
  money: string;
  to: string;
  cta: string;
}[] = [
  {
    n: 1,
    title: "A farmer delivers rice",
    plain:
      "Farmers bring freshly harvested rice to the mill. Each load is weighed and tested for moisture — wet rice rots and weighs more than it should, so moisture is the honesty test of this trade. Watch the list: one load is flagged red at 25.2% — the system caught it automatically.",
    money: "Buyers pay for dry, tested rice. A mill that can prove moisture at intake stops losing money on water.",
    to: "/deliveries",
    cta: "See the deliveries",
  },
  {
    n: 2,
    title: "No test, no payment",
    plain:
      "Farmers are paid at the gate — but this system refuses to record a payment until a moisture test exists for that load. Not a policy on a poster: the software will not let money move without the measurement.",
    money: "This single rule is why the records can be trusted. Every payment has a test behind it, forever.",
    to: "/contracts",
    cta: "See contracts & payments",
  },
  {
    n: 3,
    title: "Every kilo is accounted for",
    plain:
      "Wet rice from three farms went in — 22,830 kg. It was dried, then milled. The system reconciles what came out: white rice, broken grains, bran, husk. The difference must be zero, and here it is zero. Most mills in Cambodia guess these numbers; this one measures them.",
    money: "Milling losses are where a mill's profit silently disappears. Measuring them is worth more than any single sale.",
    to: "/batches",
    cta: "Open the batch ledger",
  },
  {
    n: 4,
    title: "Satellites watch every field",
    plain:
      "Every farm on this map is monitored from space using free European Space Agency and NASA data — and it's fast. Fire detections arrive within hours, from several satellite passes a day. Crop health refreshes about every five days at 10-metre detail. Radar tells a flooded field from a drained one through clouds and at night, then compares it against what the farmer wrote in their log. No person can walk 2,200 hectares that often.",
    money:
      "Two independent records of the same field — a farmer's log and a satellite's — is exactly what climate funds and export buyers pay to see verified. Marginal cost per field: zero.",
    to: "/map",
    cta: "Open the satellite map",
  },
  {
    n: 5,
    title: "Anyone can check",
    plain:
      "Scan a QR code on a finished batch and this page opens — no login. The farms it came from, the journey it took, and the satellite record beside the farmer's log. This is what a buyer in Singapore or an auditor in Brussels would see.",
    money: "Traceability is the ticket to premium export markets. This page is that ticket, working today.",
    to: "/trace/B26-0001" as string,
    cta: "Open the public trace",
  },
];

function TourPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Badge variant="outline" className="border-amber-500 text-amber-600 font-normal mb-2">
          Guided demo · 3 minutes · read-only
        </Badge>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Compass className="h-6 w-6" />
          A rice mill, run honestly
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          You're inside the live system that runs BRM Agro's rice operation in Kampong Thom, Cambodia. You don't need
          to know anything about rice — follow the five stops. Everything you'll see is real operating data, and
          nothing you click can break it.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Banknote className="h-4 w-4" />
            Why this exists, in one paragraph
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Cambodia ships most of its rice out raw and unproven — over a billion dollars of it a year — because its
            mills can't measure their losses or prove where a bag came from. The people with the big money — export
            buyers, climate funds, agricultural lenders — all pay for the same thing: <span className="font-medium text-foreground">proof</span>.
            This system produces that proof as a side effect of running the mill's ordinary day.
          </p>
        </CardContent>
      </Card>

      {STOPS.map((s) => (
        <Card key={s.n}>
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <span className="h-8 w-8 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold">
                {s.n}
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-base font-semibold">{s.title}</p>
                <p className="text-sm text-muted-foreground">{s.plain}</p>
                <p className="text-sm">
                  <span className="font-medium">Why money cares:</span>{" "}
                  <span className="text-muted-foreground">{s.money}</span>
                </p>
                <Button asChild size="sm" variant="outline">
                  <Link to={s.to}>
                    {s.cta} <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardContent className="pt-6 space-y-2">
          <p className="text-sm font-medium">Wander freely from here.</p>
          <p className="text-sm text-muted-foreground">
            The sidebar is the whole mill: farmer files, field visits, stock on hand, quality tests, farmer rankings,
            recall lookups, evidence packs — and "Ask your mill", where staff ask questions in Khmer and the answers
            come from the live records you just walked through. How it's all engineered:{" "}
            <a href="/system" className="underline">
              fieldwatch.live/system
            </a>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
