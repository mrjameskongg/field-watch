import { describe, expect, it } from "vitest";
import { imageryLabel, isDrySeasonMonth, summariseImagery, type ImageryCapture } from "./imagery-date";

const cap = (date: string, resM: number | null = 0.34, source: string | null = "Vivid"): ImageryCapture => ({
  date,
  resM,
  source,
});

describe("isDrySeasonMonth", () => {
  it("covers Nov through Apr", () => {
    expect([11, 12, 1, 2, 3, 4].every(isDrySeasonMonth)).toBe(true);
    expect([5, 6, 7, 8, 9, 10].some(isDrySeasonMonth)).toBe(false);
  });
});

describe("summariseImagery", () => {
  it("spans the oldest and newest capture in the mosaic", () => {
    // The real estate today: three passes stitched across fourteen months.
    const s = summariseImagery([cap("2026-02-17"), cap("2025-02-17"), cap("2026-04-24")])!;
    expect(s.from).toBe("2025-02");
    expect(s.to).toBe("2026-04");
    expect(s.allDrySeason).toBe(true);
  });

  it("collapses a single-pass mosaic to one month", () => {
    const s = summariseImagery([cap("2026-02-17"), cap("2026-02-17")])!;
    expect(s.from).toBe("2026-02");
    expect(s.to).toBe("2026-02");
  });

  it("reports the sharpest source, not the first", () => {
    const s = summariseImagery([cap("2025-01-02", 1.2, "Coarse"), cap("2026-03-04", 0.34, "Vivid")])!;
    expect(s.resM).toBe(0.34);
    expect(s.source).toBe("Vivid");
  });

  it("drops the dry-season claim when any pass is from the wet season", () => {
    expect(summariseImagery([cap("2026-02-17"), cap("2026-08-01")])!.allDrySeason).toBe(false);
  });

  it("returns null when nothing resolved", () => {
    expect(summariseImagery([])).toBeNull();
    expect(summariseImagery([cap("")])).toBeNull();
  });
});

describe("imageryLabel", () => {
  it("reads as one honest line", () => {
    const s = summariseImagery([cap("2025-02-17"), cap("2026-04-24")])!;
    expect(imageryLabel(s, "Basemap", "dry season")).toBe("Basemap 2025-02 – 2026-04 · Vivid 0.3 m · dry season");
  });

  it("omits the range when the mosaic is one pass", () => {
    const s = summariseImagery([cap("2026-02-17")])!;
    expect(imageryLabel(s, "Basemap", "dry season")).toBe("Basemap 2026-02 · Vivid 0.3 m · dry season");
  });
});
