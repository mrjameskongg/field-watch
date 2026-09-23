import { describe, expect, it } from "vitest";
import {
  DEFAULT_PUMPING_RULE,
  dieselPerHa,
  dieselSignal,
  floodStreak,
  median,
  pumpFlag,
  sortByPumping,
  type DrainLog,
  type PassRow,
  type PumpingRow,
} from "./pumping-core";

const pass = (reading_date: string, state: string, confident = state === "flooded"): PassRow => ({
  reading_date,
  state,
  confident,
});

const drainLog = (event_date: string): DrainLog => ({
  event_type: "water",
  water_state: "drained",
  event_date,
});

describe("floodStreak", () => {
  it("reports no evidence when there are no passes", () => {
    const s = floodStreak([], []);
    expect(s.passes).toBe(0);
    expect(s.latestPass).toBeNull();
    expect(s.neverDrained).toBe(false);
  });

  it("counts the trailing run of flooded passes", () => {
    const s = floodStreak(
      [pass("2026-07-01", "drained", true), pass("2026-07-13", "flooded"), pass("2026-07-25", "flooded")],
      [],
    );
    expect(s.passes).toBe(2);
    expect(s.lastDrainedDate).toBe("2026-07-01");
    expect(s.daysFlooded).toBe(24);
    expect(s.neverDrained).toBe(false);
  });

  it("measures from the first reading when the field never drained", () => {
    const s = floodStreak([pass("2026-06-10", "flooded"), pass("2026-07-20", "flooded")], []);
    expect(s.neverDrained).toBe(true);
    expect(s.daysFlooded).toBe(40);
    expect(s.lastDrainedDate).toBeNull();
  });

  it("lets an unconfident drained reading break the streak", () => {
    // Drained under a closed canopy is weak evidence, but weak evidence of
    // drying must still stop an accusation of over-pumping.
    const s = floodStreak(
      [pass("2026-07-01", "flooded"), pass("2026-07-13", "drained", false), pass("2026-07-25", "flooded")],
      [],
    );
    expect(s.passes).toBe(1);
    expect(s.daysFlooded).toBe(12);
    expect(s.confirmedDry).toBe(false);
  });

  it("only confirms drying on a confident drained reading", () => {
    const s = floodStreak([pass("2026-07-01", "drained", true), pass("2026-07-25", "flooded")], []);
    expect(s.confirmedDry).toBe(true);
  });

  it("treats uncertain passes as neutral", () => {
    const s = floodStreak(
      [pass("2026-07-01", "flooded"), pass("2026-07-13", "uncertain", false), pass("2026-07-25", "flooded")],
      [],
    );
    expect(s.passes).toBe(2);
    expect(s.neverDrained).toBe(true);
  });

  it("honours a logged drain the satellite missed", () => {
    // Sentinel-1 revisits every 6-12 days; a short dry-down can fall between
    // passes. The officer's logbook breaks the streak.
    const s = floodStreak([pass("2026-07-01", "flooded"), pass("2026-07-25", "flooded")], [drainLog("2026-07-14")]);
    expect(s.lastDrainedDate).toBe("2026-07-14");
    expect(s.daysFlooded).toBe(11);
    expect(s.neverDrained).toBe(false);
  });

  it("ignores unsorted input order", () => {
    const s = floodStreak([pass("2026-07-25", "flooded"), pass("2026-07-01", "drained", true)], []);
    expect(s.latestPass).toBe("2026-07-25");
    expect(s.passes).toBe(1);
  });
});

describe("pumpFlag", () => {
  const rule = DEFAULT_PUMPING_RULE;
  const base = { latestPass: "2026-07-25", today: "2026-07-27" };

  it("says no data when nothing was ever scanned", () => {
    expect(pumpFlag({ ...base, latestPass: null, daysFlooded: 0, neverDrained: false }, rule)).toBe("no-data");
  });

  it("says stale rather than guessing on an old scan", () => {
    expect(
      pumpFlag({ latestPass: "2026-05-01", today: "2026-07-27", daysFlooded: 90, neverDrained: true }, rule),
    ).toBe("stale");
  });

  it("flags a field that has never dried past the rule", () => {
    expect(pumpFlag({ ...base, daysFlooded: 30, neverDrained: true }, rule)).toBe("never-dried");
  });

  it("watches a field that dried once but has been wet too long since", () => {
    expect(pumpFlag({ ...base, daysFlooded: 30, neverDrained: false }, rule)).toBe("watch");
  });

  it("passes a field inside the rule", () => {
    expect(pumpFlag({ ...base, daysFlooded: 10, neverDrained: false }, rule)).toBe("ok");
  });

  it("respects a changed threshold", () => {
    expect(pumpFlag({ ...base, daysFlooded: 30, neverDrained: false }, { flagAfterDays: 45 })).toBe("ok");
  });
});

describe("dieselPerHa", () => {
  it("sums litres of diesel over the contracted area", () => {
    const value = dieselPerHa(
      [
        { item_type: "diesel", quantity: 100, unit: "L" },
        { item_type: "fertilizer", quantity: 500, unit: "kg" },
        { item_type: "fuel", quantity: 50, unit: "litre" },
      ],
      3,
    );
    expect(value).toBe(50);
  });

  it("is null without a contracted area", () => {
    expect(dieselPerHa([{ item_type: "diesel", quantity: 100, unit: "L" }], 0)).toBeNull();
  });

  it("is null when no diesel was advanced", () => {
    expect(dieselPerHa([{ item_type: "seed", quantity: 40, unit: "kg" }], 2)).toBeNull();
  });

  it("skips rows in units it cannot read rather than adding them blind", () => {
    expect(dieselPerHa([{ item_type: "diesel", quantity: 100, unit: "drums" }], 2)).toBeNull();
  });

  it("skips rows with no quantity recorded", () => {
    expect(dieselPerHa([{ item_type: "diesel", quantity: null, unit: "L" }], 2)).toBeNull();
  });
});

describe("median", () => {
  it("is null on an empty set", () => {
    expect(median([])).toBeNull();
  });

  it("averages the middle pair on an even count", () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  it("takes the middle of an odd count regardless of order", () => {
    expect(median([30, 10, 20])).toBe(20);
  });
});

describe("dieselSignal", () => {
  it("is unknown without a value or a median", () => {
    expect(dieselSignal(null, 40)).toBe("unknown");
    expect(dieselSignal(60, null)).toBe("unknown");
  });

  it("calls a quarter above the estate median high", () => {
    expect(dieselSignal(50, 40)).toBe("above");
  });

  it("treats a small difference as typical", () => {
    expect(dieselSignal(44, 40)).toBe("typical");
  });

  it("calls a quarter below the estate median low", () => {
    expect(dieselSignal(30, 40)).toBe("below");
  });
});

describe("sortByPumping", () => {
  const row = (farmId: string, flag: PumpingRow["flag"], daysFlooded: number): PumpingRow =>
    ({ farmId, farmName: farmId, flag, daysFlooded }) as PumpingRow;

  it("puts never-dried first, then watch by days flooded, then the rest", () => {
    const sorted = sortByPumping([
      row("ok", "ok", 4),
      row("watch-short", "watch", 25),
      row("stale", "stale", 0),
      row("never", "never-dried", 30),
      row("watch-long", "watch", 40),
      row("nodata", "no-data", 0),
    ]);
    expect(sorted.map((r) => r.farmId)).toEqual([
      "never",
      "watch-long",
      "watch-short",
      "ok",
      "stale",
      "nodata",
    ]);
  });
});
