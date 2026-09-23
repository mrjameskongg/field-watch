// Who may do what. One table, three consumers:
//   1. the database: buildRolePolicySql() generates the restrictive RLS policies
//      in supabase/migrations/20260923140100_roles_audit.sql (a test fails if
//      the checked-in migration drifts from this file);
//   2. the sidebar: NAV_ACCESS trims the menu to a role's working pages;
//   3. the demo "View as" switch: the same roles, applied in the database via
//      the x-demo-role header, so what the demo shows is what the role gets.
//
// The proposal's rule set: Admin corrects and deletes; Manager approves money;
// Field Officer owns farms, visits and alerts; Warehouse owns intake, batches
// and dispatch; Quality Officer owns tests. Below Admin nothing is deleted,
// and posted weights, tests and money can only be corrected by an Admin.

export const APP_ROLES = ["admin", "manager", "field_officer", "warehouse", "quality_officer"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  manager: "Manager",
  field_officer: "Field Officer",
  warehouse: "Warehouse",
  quality_officer: "Quality Officer",
};

export const ROLE_SUMMARY: Record<AppRole, string> = {
  admin: "Everything, including users, settings, corrections and deletes. Sees the audit log.",
  manager: "Contracts, prices, advances and settlements. Approves money; cannot delete or correct posted records.",
  field_officer: "Farmers, parcels, visits, crop cycles and alerts. Reads contracts; never sees settlements.",
  warehouse: "Intake, batches, weigh points, stock and dispatch. Never sees settlements, advances or market prices.",
  quality_officer: "Moisture and quality tests on deliveries and batches. Reads the weight chain; writes nothing else.",
};

const ALL: readonly AppRole[] = APP_ROLES;
const OFFICE: readonly AppRole[] = ["admin", "manager"];
const FIELD: readonly AppRole[] = ["admin", "manager", "field_officer"];
const MILL: readonly AppRole[] = ["admin", "manager", "warehouse"];

/** Tables the matrix governs. Every public table except `profiles` (own row only) and `demo_farmers` (no client access). */
export const TABLES = [
  "alerts",
  "app_settings",
  "audit_log",
  "batch_weigh_points",
  "batches",
  "buyers",
  "contracts",
  "crop_cycles",
  "deliveries",
  "dispatches",
  "farmers",
  "farms",
  "field_events",
  "field_visits",
  "files",
  "input_advances",
  "market_prices",
  "parcel_health",
  "parcel_water",
  "qc_tests",
  "settlements",
  "user_roles",
] as const;
export type Table = (typeof TABLES)[number];

/** Who may SELECT. Tables not listed are readable by every staff role. */
export const READ: Partial<Record<Table, readonly AppRole[]>> = {
  settlements: OFFICE,
  input_advances: FIELD,
  market_prices: FIELD,
  audit_log: ["admin"],
};

/** Who may INSERT and UPDATE. `null` = nobody through the API (written by triggers only). */
export const WRITE: Record<Table, readonly AppRole[] | null> = {
  alerts: FIELD,
  app_settings: ["admin"],
  audit_log: null,
  batch_weigh_points: MILL,
  batches: MILL,
  buyers: OFFICE,
  contracts: OFFICE,
  crop_cycles: FIELD,
  deliveries: ["admin", "manager", "warehouse", "field_officer"],
  dispatches: MILL,
  farmers: FIELD,
  farms: FIELD,
  field_events: FIELD,
  field_visits: FIELD,
  files: FIELD,
  input_advances: OFFICE,
  market_prices: OFFICE,
  parcel_health: OFFICE,
  parcel_water: OFFICE,
  qc_tests: ["admin", "manager", "quality_officer", "warehouse"],
  settlements: OFFICE,
  user_roles: ["admin"],
};

/** Only an admin deletes. */
export const DELETE_ROLES: readonly AppRole[] = ["admin"];

/**
 * Posted facts: once a row exists, only an admin may change these columns.
 * Linking a delivery to a batch or a settlement, or marking a settlement paid,
 * is workflow and stays open to the roles that own it.
 */
export const LOCKED_COLUMNS: Partial<Record<Table, readonly string[]>> = {
  deliveries: ["delivery_code", "contract_id", "received_date", "gross_weight_kg", "bag_count", "moisture_pct", "price_per_kg_applied"],
  qc_tests: ["delivery_id", "batch_id", "test_type", "result_value", "result_text", "passed", "tested_date"],
  batch_weigh_points: ["batch_id", "stage", "weight_kg", "moisture_pct", "estimated", "bag_count", "recorded_date"],
  input_advances: ["contract_id", "item_type", "quantity", "unit_cost", "total_cost", "date_issued", "deduct_at_settlement"],
  settlements: ["settlement_code", "contract_id", "gross_value", "total_deductions", "net_payment"],
};

/** Tables whose every insert, update and delete lands in audit_log. Satellite readings are excluded (machine output, thousands of rows). */
export const AUDITED: readonly Table[] = [
  "app_settings",
  "batch_weigh_points",
  "batches",
  "buyers",
  "contracts",
  "crop_cycles",
  "deliveries",
  "dispatches",
  "farmers",
  "farms",
  "field_events",
  "field_visits",
  "files",
  "input_advances",
  "market_prices",
  "qc_tests",
  "settlements",
  "user_roles",
];
/** Alerts are created by scans in bulk; only their resolution (update) and deletion are audited. */
export const AUDITED_CHANGES_ONLY: readonly Table[] = ["alerts"];

export function canRead(roles: readonly AppRole[], table: Table): boolean {
  const allowed = READ[table] ?? ALL;
  return roles.some((r) => allowed.includes(r));
}

export function canWrite(roles: readonly AppRole[], table: Table): boolean {
  const allowed = WRITE[table];
  return !!allowed && roles.some((r) => allowed.includes(r));
}

export function canDelete(roles: readonly AppRole[]): boolean {
  return roles.some((r) => DELETE_ROLES.includes(r));
}

export function canCorrect(roles: readonly AppRole[]): boolean {
  return roles.includes("admin");
}

/** Sidebar pages per role. A page not listed is open to every role. */
export const NAV_ACCESS: Record<string, readonly AppRole[]> = {
  "/farms": FIELD,
  "/visits": FIELD,
  "/alerts": FIELD,
  "/map": FIELD,
  "/water": FIELD,
  "/contracts": FIELD,
  "/deliveries": ["admin", "manager", "warehouse", "field_officer"],
  "/batches": ["admin", "manager", "warehouse", "quality_officer"],
  "/stock": MILL,
  "/dispatches": MILL,
  "/qc": ["admin", "manager", "quality_officer", "warehouse"],
  "/ranking": OFFICE,
  "/prices": FIELD,
  "/recall": ["admin", "manager", "warehouse", "quality_officer"],
  "/compliance": OFFICE,
  "/reports": OFFICE,
  "/audit": ["admin"],
  "/users": ["admin"],
  "/settings": ["admin"],
};

export function navAllowed(roles: readonly AppRole[], url: string): boolean {
  const allowed = NAV_ACCESS[url];
  return !allowed || roles.some((r) => allowed.includes(r));
}

export function isAppRole(v: unknown): v is AppRole {
  return typeof v === "string" && (APP_ROLES as readonly string[]).includes(v);
}

const sqlRoles = (roles: readonly AppRole[]) => `'{${roles.join(",")}}'::public.app_role[]`;
// Wrapped in a scalar subquery so Postgres evaluates it once per statement, not once per row.
const allows = (roles: readonly AppRole[]) => `(select public.role_allows(${sqlRoles(roles)}))`;

/**
 * The restrictive policies for the matrix above. Restrictive policies AND with
 * the existing permissive ones, so this can only narrow access, never widen it.
 */
export function buildRolePolicySql(): string {
  const out: string[] = [];
  for (const t of TABLES) {
    const read = READ[t];
    const write = WRITE[t];
    out.push(`-- ${t}`);
    for (const p of ["role_read", "role_insert", "role_update", "role_delete"]) {
      out.push(`drop policy if exists ${p} on public.${t};`);
    }
    if (read) {
      out.push(`create policy role_read on public.${t} as restrictive for select to authenticated using (${allows(read)});`);
    }
    const w = write ? allows(write) : "false";
    out.push(`create policy role_insert on public.${t} as restrictive for insert to authenticated with check (${w});`);
    out.push(`create policy role_update on public.${t} as restrictive for update to authenticated using (${w}) with check (${w});`);
    const d = write ? allows(DELETE_ROLES) : "false";
    out.push(`create policy role_delete on public.${t} as restrictive for delete to authenticated using (${d});`);
  }
  out.push("");
  out.push("-- Posted facts: only an admin may change these columns once a row exists.");
  for (const [t, cols] of Object.entries(LOCKED_COLUMNS)) {
    out.push(`drop trigger if exists lock_posted_facts on public.${t};`);
    out.push(
      `create trigger lock_posted_facts before update on public.${t} for each row execute function public.lock_posted_facts(${cols.map((c) => `'${c}'`).join(", ")});`,
    );
  }
  out.push("");
  out.push("-- Audit trail.");
  for (const t of AUDITED) {
    out.push(`drop trigger if exists audit_row on public.${t};`);
    out.push(`create trigger audit_row after insert or update or delete on public.${t} for each row execute function public.audit_row();`);
  }
  for (const t of AUDITED_CHANGES_ONLY) {
    out.push(`drop trigger if exists audit_row on public.${t};`);
    out.push(`create trigger audit_row after update or delete on public.${t} for each row execute function public.audit_row();`);
  }
  return out.join("\n") + "\n";
}
