import { describe, expect, it } from "vitest";
import { awdSummary, type AwdEvent, type AwdCheck, radarVerdict } from "./awd-core";

const evt = (partial: Partial<AwdEvent>): AwdEvent => ({
  event_type: "water",
  water_state: null,
  event_date: "2026-08-01",
  ...partial,
});

const chk = (agreement: AwdCheck["agreement"]): AwdCheck => ({ agreement });

describe("awdSummary", () => {
  it("reports 'none' with zero cycles when there are no events", () => {
    const result = awdSummary([], []);
    expect(result).toEqual({
      cycles: 0,
      radarPasses: 0,
      decisive: 0,
      agreementPct: null,
      verdict: "none",
    });
  });

  it("reports 'unverified' when there are cycles but no radar checks", () => {
    const events = [
      evt({ water_state: "drained" }),
      evt({ water_state: "drained" }),
      evt({ water_state: "drained" }),
    ];
    const result = awdSummary(events, []);
    expect(result.cycles).toBe(3);
    expect(result.radarPasses).toBe(0);
    expect(result.decisive).toBe(0);
    expect(result.agreementPct).toBeNull();
    expect(result.verdict).toBe("unverified");
  });

  it("reports 'confirmed' when agreement is 70% or higher", () => {
    const events = [
      evt({ water_state: "drained" }),
      evt({ water_state: "drained" }),
      evt({ water_state: "drained" }),
    ];
    const checks = [chk("agrees"), chk("agrees"), chk("agrees"), chk("disagrees")];
    const result = awdSummary(events, checks);
    expect(result.cycles).toBe(3);
    expect(result.radarPasses).toBe(4);
    expect(result.decisive).toBe(4);
    expect(result.agreementPct).toBe(75);
    expect(result.verdict).toBe("confirmed");
  });

  it("reports 'confirmed' at exactly the 70% boundary", () => {
    const events = [evt({ water_state: "drained" })];
    const checks = [
      chk("agrees"),
      chk("agrees"),
      chk("agrees"),
      chk("agrees"),
      chk("agrees"),
      chk("agrees"),
      chk("agrees"),
      chk("disagrees"),
      chk("disagrees"),
      chk("disagrees"),
    ];
    const result = awdSummary(events, checks);
    expect(result.decisive).toBe(10);
    expect(result.agreementPct).toBe(70);
    expect(result.verdict).toBe("confirmed");
  });

  it("reports 'partial' when agreement is below 70%", () => {
    const events = [evt({ water_state: "drained" }), evt({ water_state: "drained" })];
    const checks = [chk("agrees"), chk("agrees"), chk("disagrees"), chk("disagrees")];
    const result = awdSummary(events, checks);
    expect(result.cycles).toBe(2);
    expect(result.decisive).toBe(4);
    expect(result.agreementPct).toBe(50);
    expect(result.verdict).toBe("partial");
  });

  it("excludes inconclusive/unconfirmed checks from decisive but counts them in radarPasses", () => {
    const events = [evt({ water_state: "drained" })];
    const checks = [chk("agrees"), chk("agrees"), chk("agrees"), chk("inconclusive"), chk("unconfirmed")];
    const result = awdSummary(events, checks);
    expect(result.cycles).toBe(1);
    expect(result.radarPasses).toBe(5);
    expect(result.decisive).toBe(3);
    expect(result.agreementPct).toBe(100);
    expect(result.verdict).toBe("confirmed");
  });

  it("only counts water events with water_state 'drained' as cycles", () => {
    const events = [
      evt({ water_state: "drained" }),
      evt({ water_state: "flooded" }),
      evt({ event_type: "fertiliser", water_state: null }),
    ];
    const result = awdSummary(events, []);
    expect(result.cycles).toBe(1);
    expect(result.verdict).toBe("unverified");
  });
});

describe("radarVerdict", () => {
  const pass = (date: string, state: "flooded" | "drained" | "uncertain", grade: "high" | "medium" | "low" = "high") => ({
    date, state, confidence: { grade },
  });
  it("calls a run of dry passes dry, counting only decisive passes", () => {
    const v = radarVerdict([pass("2026-07-31", "drained"), pass("2026-08-12", "uncertain"), pass("2026-08-24", "drained"), pass("2026-08-28", "drained", "low")]);
    expect(v).toEqual({ key: "dry-all", dry: 3, decisive: 3, since: "2026-07-31", latest: "2026-08-28" });
  });
  it("reports a recent flood when the latest decisive pass is flooded", () => {
    const v = radarVerdict([pass("2026-08-01", "drained"), pass("2026-08-13", "flooded"), pass("2026-08-25", "flooded")]);
    expect(v.key).toBe("flooded-now");
    expect(v.dry).toBe(1);
    expect(v.decisive).toBe(3);
  });
  it("calls it mixed when the field dried after flooding", () => {
    const v = radarVerdict([pass("2026-08-01", "flooded"), pass("2026-08-13", "flooded"), pass("2026-08-25", "drained")]);
    expect(v.key).toBe("dried-after-flood");
  });
  it("has nothing to say without decisive passes", () => {
    expect(radarVerdict([pass("2026-08-01", "uncertain")]).key).toBe("none");
    expect(radarVerdict([]).key).toBe("none");
  });
});
