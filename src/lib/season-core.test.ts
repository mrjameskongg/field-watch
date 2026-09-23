import { describe, expect, it } from "vitest";
import {
  bagsToKg,
  canCloseSeason,
  canLogEvent,
  daysInSeason,
  drySpellCount,
  eventFields,
  eventSummary,
  fertiliserTotalKg,
  offerPlanting,
  openOnly,
  seasonProgress,
  suggestSeasonLabel,
  type EventRow,
} from "./season-core";

const ev = (partial: Partial<EventRow>): EventRow => ({
  id: "e1",
  event_type: "other",
  event_date: "2026-08-01",
  product: null,
  quantity: null,
  unit: null,
  water_state: null,
  water_depth_cm: null,
  note: null,
  ...partial,
});

describe("suggestSeasonLabel", () => {
  it("labels May–October plantings as the wet season of that year", () => {
    expect(suggestSeasonLabel("2026-05-01")).toBe("Wet 2026");
    expect(suggestSeasonLabel("2026-08-14")).toBe("Wet 2026");
    expect(suggestSeasonLabel("2026-10-31")).toBe("Wet 2026");
  });
  it("labels January–April plantings as the dry season of that year", () => {
    expect(suggestSeasonLabel("2026-01-15")).toBe("Dry 2026");
    expect(suggestSeasonLabel("2026-04-30")).toBe("Dry 2026");
  });
  it("labels November–December plantings as the following year's dry season", () => {
    expect(suggestSeasonLabel("2026-11-20")).toBe("Dry 2027");
    expect(suggestSeasonLabel("2026-12-31")).toBe("Dry 2027");
  });
});

describe("daysInSeason", () => {
  it("counts from planting to today for an active season", () => {
    expect(daysInSeason({ planting_date: "2026-08-01", harvest_date: null }, "2026-08-14")).toBe(13);
  });
  it("counts from planting to harvest for a closed season", () => {
    expect(daysInSeason({ planting_date: "2026-05-01", harvest_date: "2026-09-01" }, "2026-12-01")).toBe(123);
  });
  it("never returns a negative count", () => {
    expect(daysInSeason({ planting_date: "2026-08-20", harvest_date: null }, "2026-08-14")).toBe(0);
  });
});

describe("seasonProgress", () => {
  it("is null without an expected harvest date", () => {
    expect(seasonProgress({ planting_date: "2026-08-01", expected_harvest_date: null }, "2026-08-14")).toBeNull();
  });
  it("reports the fraction elapsed", () => {
    expect(seasonProgress({ planting_date: "2026-08-01", expected_harvest_date: "2026-08-21" }, "2026-08-11")).toBeCloseTo(0.5);
  });
  it("clamps past-due seasons to 1", () => {
    expect(seasonProgress({ planting_date: "2026-05-01", expected_harvest_date: "2026-06-01" }, "2026-08-14")).toBe(1);
  });
  it("rejects an expectation on or before planting", () => {
    expect(seasonProgress({ planting_date: "2026-08-01", expected_harvest_date: "2026-08-01" }, "2026-08-14")).toBeNull();
  });
});

describe("drySpellCount", () => {
  it("counts only drained water events", () => {
    const events = [
      ev({ event_type: "water", water_state: "drained" }),
      ev({ event_type: "water", water_state: "flooded" }),
      ev({ event_type: "water", water_state: "drained" }),
      ev({ event_type: "fertiliser" }),
    ];
    expect(drySpellCount(events)).toBe(2);
  });
});

describe("fertiliserTotalKg", () => {
  it("sums kg directly and converts bags at 50 kg", () => {
    const events = [
      ev({ event_type: "fertiliser", quantity: 25, unit: "kg" }),
      ev({ event_type: "fertiliser", quantity: 2, unit: "bags" }),
    ];
    expect(fertiliserTotalKg(events)).toBe(125);
  });
  it("treats a missing unit as kg", () => {
    expect(fertiliserTotalKg([ev({ event_type: "fertiliser", quantity: 10, unit: null })])).toBe(10);
  });
  it("leaves litres out of the kg total and ignores other event types", () => {
    const events = [
      ev({ event_type: "fertiliser", quantity: 5, unit: "L" }),
      ev({ event_type: "pesticide", quantity: 100, unit: "kg" }),
    ];
    expect(fertiliserTotalKg(events)).toBe(0);
  });
});

describe("bagsToKg", () => {
  it("defaults to 50 kg per bag", () => {
    expect(bagsToKg(3)).toBe(150);
    expect(bagsToKg(2, 40)).toBe(80);
  });
});

describe("eventFields", () => {
  it("shows water fields only for water events", () => {
    expect(eventFields("water")).toEqual({ water: true, product: false, note: true });
  });
  it("shows product fields for fertiliser and pesticide", () => {
    expect(eventFields("fertiliser")).toEqual({ water: false, product: true, note: true });
    expect(eventFields("pesticide")).toEqual({ water: false, product: true, note: true });
  });
  it("shows only date and note for planting and other", () => {
    expect(eventFields("planting")).toEqual({ water: false, product: false, note: true });
    expect(eventFields("other")).toEqual({ water: false, product: false, note: true });
  });
});

describe("canLogEvent", () => {
  it("allows logging only on an active cycle", () => {
    expect(canLogEvent({ status: "active" })).toBe(true);
    expect(canLogEvent({ status: "closed" })).toBe(false);
    expect(canLogEvent(null)).toBe(false);
  });
});

describe("canCloseSeason", () => {
  it("requires a harvest date", () => {
    expect(canCloseSeason({ harvestDate: "", yieldValue: 100 }).ok).toBe(false);
  });
  it("requires a positive yield", () => {
    expect(canCloseSeason({ harvestDate: "2026-11-01", yieldValue: null }).ok).toBe(false);
    expect(canCloseSeason({ harvestDate: "2026-11-01", yieldValue: 0 }).ok).toBe(false);
    expect(canCloseSeason({ harvestDate: "2026-11-01", yieldValue: -5 }).ok).toBe(false);
  });
  it("passes with both", () => {
    expect(canCloseSeason({ harvestDate: "2026-11-01", yieldValue: 1200 }).ok).toBe(true);
  });
});

describe("offerPlanting", () => {
  it("offers planting until one is recorded", () => {
    expect(offerPlanting([])).toBe(true);
    expect(offerPlanting([ev({ event_type: "water" })])).toBe(true);
    expect(offerPlanting([ev({ event_type: "planting" })])).toBe(false);
  });
});

describe("eventSummary", () => {
  it("describes water events with the tube reading", () => {
    expect(eventSummary(ev({ event_type: "water", water_state: "drained", water_depth_cm: 12 })))
      .toBe("Field drained (12 cm below surface)");
    expect(eventSummary(ev({ event_type: "water", water_state: "flooded" }))).toBe("Field flooded");
  });
  it("describes input events with product and quantity", () => {
    expect(eventSummary(ev({ event_type: "fertiliser", product: "Urea", quantity: 2, unit: "bags" })))
      .toBe("Urea — 2 bags");
    expect(eventSummary(ev({ event_type: "pesticide", product: null }))).toBe("Pesticide");
  });
  it("describes planting and notes", () => {
    expect(eventSummary(ev({ event_type: "planting" }))).toBe("Planted");
    expect(eventSummary(ev({ event_type: "other", note: "Repaired bund" }))).toBe("Repaired bund");
  });
});

describe("openOnly", () => {
  it("drops rows whose contract season is closed and keeps the rest", () => {
    const rows = [
      { id: "a", contracts: { season_closed: true } },
      { id: "b", contracts: { season_closed: false } },
      { id: "c", contracts: null },
      { id: "d" },
    ];
    expect(openOnly(rows).map((r) => r.id)).toEqual(["b", "c", "d"]);
  });
});
