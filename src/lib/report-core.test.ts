import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";
import { REPORT_COLUMNS, type AreaByProvince } from "./report-core";

describe("REPORT_COLUMNS", () => {
  it("exports area by province in header order", () => {
    const rows: AreaByProvince[] = [
      { province: "Battambang", farm_count: 3, mapped_count: 2, total_hectares: 12.5 },
    ];
    expect(toCsv(rows, REPORT_COLUMNS.area)).toBe(
      "province,farm_count,mapped_count,total_hectares\nBattambang,3,2,12.5\n",
    );
  });

  it("covers every view", () => {
    expect(Object.keys(REPORT_COLUMNS).sort()).toEqual(["alerts", "area", "deliveries", "settlements"]);
  });

  it("quotes a province name containing a comma", () => {
    const rows: AreaByProvince[] = [
      { province: "Preah Vihear, north", farm_count: 1, mapped_count: 0, total_hectares: 0 },
    ];
    expect(toCsv(rows, REPORT_COLUMNS.area)).toContain('"Preah Vihear, north"');
  });
});
