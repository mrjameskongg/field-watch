import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APP_ROLES,
  AUDITED,
  LOCKED_COLUMNS,
  TABLES,
  WRITE,
  buildRolePolicySql,
  canCorrect,
  canDelete,
  canRead,
  canWrite,
  isAppRole,
  navAllowed,
  type AppRole,
  type Table,
} from "./roles-core";

const writable = (role: AppRole) => TABLES.filter((t) => canWrite([role], t));

// The role table in the project proposal, section 3, as assertions.
describe("proposal role table", () => {
  it("has the five staff roles", () => {
    expect([...APP_ROLES]).toEqual(["admin", "manager", "field_officer", "warehouse", "quality_officer"]);
  });

  it("admin writes every table that takes writes, deletes, and corrects posted records", () => {
    for (const t of TABLES) if (WRITE[t]) expect(canWrite(["admin"], t)).toBe(true);
    expect(canDelete(["admin"])).toBe(true);
    expect(canCorrect(["admin"])).toBe(true);
  });

  it("only admin deletes or corrects: records are append-only below admin", () => {
    for (const r of APP_ROLES.filter((r) => r !== "admin")) {
      expect(canDelete([r])).toBe(false);
      expect(canCorrect([r])).toBe(false);
    }
  });

  it("manager approves money and sets prices, but cannot manage users or settings", () => {
    for (const t of ["contracts", "input_advances", "settlements", "market_prices"] as Table[]) {
      expect(canWrite(["manager"], t)).toBe(true);
    }
    expect(canWrite(["manager"], "user_roles")).toBe(false);
    expect(canWrite(["manager"], "app_settings")).toBe(false);
    expect(canRead(["manager"], "audit_log")).toBe(false);
  });

  it("field officer registers farmers and farms, logs visits and resolves alerts", () => {
    for (const t of ["farmers", "farms", "field_visits", "crop_cycles", "alerts"] as Table[]) {
      expect(canWrite(["field_officer"], t)).toBe(true);
    }
  });

  it("field officer reads contract terms but cannot set price or advance, and never sees settlements", () => {
    expect(canRead(["field_officer"], "contracts")).toBe(true);
    expect(canWrite(["field_officer"], "contracts")).toBe(false);
    expect(canWrite(["field_officer"], "input_advances")).toBe(false);
    expect(canWrite(["field_officer"], "market_prices")).toBe(false);
    expect(canRead(["field_officer"], "settlements")).toBe(false);
  });

  it("warehouse records deliveries, makes batches and dispatches, and cannot see money", () => {
    for (const t of ["deliveries", "batches", "batch_weigh_points", "dispatches"] as Table[]) {
      expect(canWrite(["warehouse"], t)).toBe(true);
    }
    for (const t of ["settlements", "input_advances", "market_prices"] as Table[]) {
      expect(canRead(["warehouse"], t)).toBe(false);
    }
  });

  it("quality officer writes tests and nothing else", () => {
    expect(writable("quality_officer")).toEqual(["qc_tests"]);
    expect(canRead(["quality_officer"], "batches")).toBe(true);
    expect(canRead(["quality_officer"], "deliveries")).toBe(true);
    for (const t of ["settlements", "input_advances", "market_prices"] as Table[]) {
      expect(canRead(["quality_officer"], t)).toBe(false);
    }
  });

  it("nobody writes the audit log through the API; only admin reads it", () => {
    for (const r of APP_ROLES) expect(canWrite([r], "audit_log")).toBe(false);
    expect(APP_ROLES.filter((r) => canRead([r], "audit_log"))).toEqual(["admin"]);
  });

  it("a person with two roles gets the union", () => {
    expect(canWrite(["quality_officer", "field_officer"], "farms")).toBe(true);
    expect(canWrite(["quality_officer", "field_officer"], "qc_tests")).toBe(true);
  });

  it("no roles, no access", () => {
    for (const t of TABLES) {
      expect(canRead([], t)).toBe(false);
      expect(canWrite([], t)).toBe(false);
    }
  });
});

describe("posted facts", () => {
  it("locks weights, tests and money, not workflow links", () => {
    expect(LOCKED_COLUMNS.deliveries).toContain("gross_weight_kg");
    expect(LOCKED_COLUMNS.deliveries).toContain("price_per_kg_applied");
    expect(LOCKED_COLUMNS.deliveries).not.toContain("batch_id");
    expect(LOCKED_COLUMNS.deliveries).not.toContain("settlement_id");
    expect(LOCKED_COLUMNS.settlements).toContain("net_payment");
    expect(LOCKED_COLUMNS.settlements).not.toContain("status");
    expect(LOCKED_COLUMNS.input_advances).not.toContain("settlement_id");
  });

  it("every locked or audited table is a governed table", () => {
    for (const t of [...Object.keys(LOCKED_COLUMNS), ...AUDITED]) {
      expect(TABLES as readonly string[]).toContain(t);
    }
  });
});

describe("navigation", () => {
  it("trims the menu to each role's working pages", () => {
    expect(navAllowed(["warehouse"], "/deliveries")).toBe(true);
    expect(navAllowed(["warehouse"], "/stock")).toBe(true);
    expect(navAllowed(["warehouse"], "/contracts")).toBe(false);
    expect(navAllowed(["quality_officer"], "/qc")).toBe(true);
    expect(navAllowed(["quality_officer"], "/stock")).toBe(false);
    expect(navAllowed(["field_officer"], "/visits")).toBe(true);
    expect(navAllowed(["field_officer"], "/ranking")).toBe(false);
    expect(navAllowed(["manager"], "/audit")).toBe(false);
    expect(navAllowed(["admin"], "/audit")).toBe(true);
  });

  it("pages with no rule are open to everyone", () => {
    for (const r of APP_ROLES) expect(navAllowed([r], "/dashboard")).toBe(true);
  });
});

describe("isAppRole", () => {
  it("accepts the five roles only", () => {
    expect(isAppRole("warehouse")).toBe(true);
    expect(isAppRole("owner")).toBe(false);
    expect(isAppRole(null)).toBe(false);
  });
});

describe("generated SQL", () => {
  const sql = buildRolePolicySql();

  it("gives every governed table insert, update and delete policies", () => {
    for (const t of TABLES) {
      expect(sql).toContain(`create policy role_insert on public.${t} `);
      expect(sql).toContain(`create policy role_update on public.${t} `);
      expect(sql).toContain(`create policy role_delete on public.${t} `);
    }
  });

  it("only uses restrictive policies, so it can never widen access", () => {
    const creates = sql.split("\n").filter((l) => l.startsWith("create policy"));
    expect(creates.length).toBeGreaterThan(0);
    for (const l of creates) expect(l).toContain(" as restrictive ");
  });

  it("matches the checked-in migration (run `npm run gen:policies` after changing roles-core.ts)", () => {
    const file = readFileSync(new URL("../../supabase/migrations/20260923140100_roles_audit.sql", import.meta.url), "utf8");
    const begin = "-- BEGIN GENERATED (roles-core.ts)\n";
    const block = file.slice(file.indexOf(begin) + begin.length, file.indexOf("-- END GENERATED (roles-core.ts)"));
    expect(block).toBe(sql);
  });
});
