import { describe, expect, it } from "vitest";
import { contractDisplayStatus, matchContracts, type ContractSearchRow } from "./contract-core";

describe("contractDisplayStatus", () => {
  it("cancelled wins over everything", () => {
    expect(contractDisplayStatus({ status: "cancelled", season_closed: true })).toEqual({
      key: "cancelled",
      label: "Cancelled",
    });
  });

  it("completed contract is Completed even when the season is closed", () => {
    expect(contractDisplayStatus({ status: "completed", season_closed: true }).label).toBe("Completed");
  });

  it("active contract in a closed season reads Season closed, never Active", () => {
    const s = contractDisplayStatus({ status: "active", season_closed: true });
    expect(s).toEqual({ key: "season_closed", label: "Season closed" });
  });

  it("active contract in an open season is Active", () => {
    expect(contractDisplayStatus({ status: "active", season_closed: false })).toEqual({
      key: "active",
      label: "Active",
    });
  });

  it("unknown status falls back to a capitalised copy of the raw value", () => {
    expect(contractDisplayStatus({ status: "draft", season_closed: false }).label).toBe("Draft");
  });
});

describe("matchContracts", () => {
  const rows: ContractSearchRow[] = [
    { id: "1", contract_code: "CT-2026-001", season_label: "2026 dry", farmer_name: "Chan Sophea", farmer_code: "FRM-001" },
    { id: "2", contract_code: "CT-2026-002", season_label: "2026 dry", farmer_name: "Sok Vanna", farmer_code: "FRM-002" },
    { id: "3", contract_code: "CT-2026-003", season_label: "2026 wet", farmer_name: "Chan Sophea", farmer_code: "FRM-001" },
    { id: "4", contract_code: "CT-DV-054", season_label: "2025/26", farmer_name: "ចាន់ សុភា", farmer_code: "FRM-073349" },
  ];

  it("empty query returns every contract in farmer order", () => {
    expect(matchContracts(rows, "").map((r) => r.id)).toEqual(["1", "3", "2", "4"]);
  });

  it("matches on farmer name, case-insensitive, any word", () => {
    expect(matchContracts(rows, "sophea").map((r) => r.id)).toEqual(["1", "3"]);
    expect(matchContracts(rows, "VANNA").map((r) => r.id)).toEqual(["2"]);
  });

  it("matches on farmer code and contract code, with or without dashes", () => {
    expect(matchContracts(rows, "frm002").map((r) => r.id)).toEqual(["2"]);
    expect(matchContracts(rows, "dv054").map((r) => r.id)).toEqual(["4"]);
  });

  it("matches Khmer text", () => {
    expect(matchContracts(rows, "ចាន់").map((r) => r.id)).toEqual(["4"]);
  });

  it("caps the list", () => {
    expect(matchContracts(rows, "", 2)).toHaveLength(2);
  });
});
