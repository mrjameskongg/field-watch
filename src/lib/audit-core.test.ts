import { describe, expect, it } from "vitest";
import { actorLabel, describeChanges, formatValue, isCorrection, recordName, tableLabel, type AuditEntry } from "./audit-core";
import { LOCKED_COLUMNS } from "./roles-core";

const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  id: 1,
  at: "2026-09-24T02:00:00Z",
  actor_email: "admin@example.com",
  actor_roles: "admin",
  table_name: "deliveries",
  row_id: "fcf6b7f0-509c-4931-8c6a-bfcf2aa87cc6",
  action: "update",
  changes: {},
  ...over,
});

describe("describeChanges", () => {
  it("shows each changed field as old → new", () => {
    const e = entry({ changes: { gross_weight_kg: { old: 6240, new: 6200 }, quality_notes: { old: null, new: "re-weighed" } } });
    expect(describeChanges(e)).toEqual(["gross weight kg: 6240 → 6200", "quality notes: empty → re-weighed"]);
  });

  it("drops bookkeeping columns", () => {
    const e = entry({ changes: { updated_at: { old: "a", new: "b" }, status: { old: "draft", new: "paid" } } });
    expect(describeChanges(e)).toEqual(["status: draft → paid"]);
  });

  it("names an added or deleted record by its code", () => {
    expect(describeChanges(entry({ action: "insert", changes: { delivery_code: "DL-2026-108", gross_weight_kg: 5000 } }))).toEqual([
      "Added delivery DL-2026-108",
    ]);
    expect(describeChanges(entry({ action: "delete", table_name: "farmers", changes: { full_name: "Chan Sophea" } }))).toEqual([
      "Deleted farmer Chan Sophea",
    ]);
  });

  it("returns nothing for malformed changes", () => {
    expect(describeChanges(entry({ changes: null }))).toEqual([]);
  });
});

describe("recordName", () => {
  it("uses the label the trigger stored", () => {
    expect(recordName(entry({ row_label: "DL-2026-107", changes: { gross_weight_kg: { old: 5140, new: 5135 } } }))).toBe("DL-2026-107");
  });

  it("prefers a code, and reads it from an update diff", () => {
    expect(recordName(entry({ changes: { settlement_code: { old: "ST-1", new: "ST-1" }, status: { old: "draft", new: "paid" } } }))).toBe("ST-1");
  });

  it("falls back to the short row id", () => {
    expect(recordName(entry({ changes: { moisture_pct: { old: 22, new: 21 } } }))).toBe("fcf6b7f0");
  });
});

describe("labels", () => {
  it("says who did it, or that a server job did", () => {
    expect(actorLabel({ actor_email: "m@example.com", actor_roles: "field_officer" })).toBe("m@example.com (field officer)");
    expect(actorLabel({ actor_email: null, actor_roles: null })).toBe("System (server job)");
  });

  it("formats values for reading", () => {
    expect(formatValue(null)).toBe("empty");
    expect(formatValue(true)).toBe("yes");
    expect(formatValue("x".repeat(60))).toHaveLength(48);
    expect(tableLabel("qc_tests")).toBe("QC test");
    expect(tableLabel("something_new")).toBe("something new");
  });
});

describe("isCorrection", () => {
  it("flags an update to a posted fact", () => {
    expect(isCorrection(entry({ changes: { gross_weight_kg: { old: 1, new: 2 } } }), LOCKED_COLUMNS)).toBe(true);
  });

  it("does not flag workflow links or notes", () => {
    expect(isCorrection(entry({ changes: { batch_id: { old: null, new: "b" } } }), LOCKED_COLUMNS)).toBe(false);
    expect(isCorrection(entry({ action: "insert", changes: { gross_weight_kg: 5 } }), LOCKED_COLUMNS)).toBe(false);
  });
});
