// Pure helpers for the AWD (Alternate Wetting & Drying) season summary card.
// Deliberately takes plain row shapes rather than importing season-core or
// water-core types — the card mixes a cycle-scoped event count (how many
// times the field was logged as drained-down) with a farm-wide radar
// cross-check (how often the satellite backed that log up), and those two
// inputs come from different queries, so the pure function stays agnostic
// about where either one came from.

/** A logged field event, as stored in field_events. Only the AWD-relevant
 *  columns are required. */
export interface AwdEvent {
  event_type: string;
  water_state: string | null;
  event_date: string;
}

/** The one field of a water-core CrossCheck this summary actually needs. */
export interface AwdCheck {
  agreement: string;
}

export interface AwdSummary {
  /** Drain-down events logged this season — one AWD cycle each. */
  cycles: number;
  /** Radar passes compared against the log, decisive or not. */
  radarPasses: number;
  /** Radar passes that were decisive (agrees or disagrees). */
  decisive: number;
  /** Share of decisive passes that agreed, rounded. Null with no decisive passes. */
  agreementPct: number | null;
  verdict: "confirmed" | "partial" | "unverified" | "none";
}

/**
 * Summarise a season's AWD cycles against how well radar backs up the field
 * log. cycles come from the logged events (a drain-down the officer wrote
 * down); agreementPct comes from the radar cross-check (an independent
 * satellite pass). The two counts are allowed to disagree in size — the
 * verdict only cares whether cycles happened and, if so, whether radar
 * confirms them.
 */
export function awdSummary(events: AwdEvent[], checks: AwdCheck[]): AwdSummary {
  const cycles = events.filter((e) => e.event_type === "water" && e.water_state === "drained").length;

  const radarPasses = checks.length;
  const decisiveChecks = checks.filter((c) => c.agreement === "agrees" || c.agreement === "disagrees");
  const decisive = decisiveChecks.length;
  const agreementPct =
    decisive === 0
      ? null
      : Math.round((decisiveChecks.filter((c) => c.agreement === "agrees").length / decisive) * 100);

  let verdict: AwdSummary["verdict"];
  if (cycles === 0) verdict = "none";
  else if (decisive === 0) verdict = "unverified";
  else if (agreementPct !== null && agreementPct >= 70) verdict = "confirmed";
  else verdict = "partial";

  return { cycles, radarPasses, decisive, agreementPct, verdict };
}

/* ------------------------------------------------------------------ */
/* One-sentence radar verdict for the public trace page                */
/* ------------------------------------------------------------------ */

export interface RadarPassLite {
  date: string;
  state: "flooded" | "drained" | "uncertain";
  confidence: { grade: "high" | "medium" | "low" };
}

export type RadarVerdictKey = "dry-all" | "flooded-now" | "dried-after-flood" | "none";

export interface RadarVerdict {
  key: RadarVerdictKey;
  /** Decisive passes that read drained. */
  dry: number;
  /** Passes that read flooded or drained (uncertain ones do not count). */
  decisive: number;
  since: string | null;
  latest: string | null;
}

/**
 * Reduce a parcel's radar series to the sentence a buyer wants: was the
 * field dry the whole time, is it flooded right now, or did it dry down
 * after a flood? Uncertain passes are ignored; low-confidence drained
 * passes still count as drained (canopy only pushes readings the other way).
 */
export function radarVerdict(series: RadarPassLite[]): RadarVerdict {
  const decisive = series.filter((p) => p.state === "flooded" || p.state === "drained").slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  if (decisive.length === 0) return { key: "none", dry: 0, decisive: 0, since: null, latest: null };
  const dry = decisive.filter((p) => p.state === "drained").length;
  const latest = decisive[decisive.length - 1];
  const since = decisive[0].date;
  if (dry === decisive.length) return { key: "dry-all", dry, decisive: decisive.length, since, latest: latest.date };
  if (latest.state === "flooded") return { key: "flooded-now", dry, decisive: decisive.length, since, latest: latest.date };
  return { key: "dried-after-flood", dry, decisive: decisive.length, since, latest: latest.date };
}
