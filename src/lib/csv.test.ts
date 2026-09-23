import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  it("leaves a plain value alone", () => {
    expect(csvCell("Battambang")).toBe("Battambang");
  });
  it("quotes a value containing a comma", () => {
    expect(csvCell("Prey Veng, Cambodia")).toBe('"Prey Veng, Cambodia"');
  });
  it("doubles an embedded quote", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });
  it("quotes a value containing a newline", () => {
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });
  it("renders null and undefined as empty", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
  it("renders zero as zero, not empty", () => {
    expect(csvCell(0)).toBe("0");
  });
});

describe("toCsv", () => {
  it("writes a header row then one row per record", () => {
    const out = toCsv(
      [{ code: "FRM-1", ha: 2.5 as number | null }, { code: "FRM-2", ha: null }],
      [
        { key: "farm_code", get: (r) => r.code },
        { key: "area_hectares", get: (r) => r.ha },
      ],
    );
    expect(out).toBe("farm_code,area_hectares\nFRM-1,2.5\nFRM-2,\n");
  });
  it("writes a header even with no rows", () => {
    expect(toCsv([] as { code: string }[], [{ key: "farm_code", get: (r) => r.code }])).toBe("farm_code\n");
  });
});
