// Turns audit_log rows into sentences a manager can read: who changed what,
// from what, to what. The rows are written by the audit_row() trigger in
// supabase/migrations/20260923140100_roles_audit.sql.

export type AuditAction = "insert" | "update" | "delete";

export interface AuditEntry {
  id: number;
  at: string;
  actor_email: string | null;
  actor_roles: string | null;
  table_name: string;
  row_id: string | null;
  row_label?: string | null;
  action: AuditAction | string;
  changes: unknown;
}

export const TABLE_LABELS: Record<string, string> = {
  alerts: "Alert",
  app_settings: "Settings",
  batch_weigh_points: "Weigh point",
  batches: "Batch",
  buyers: "Buyer",
  contracts: "Contract",
  crop_cycles: "Crop cycle",
  deliveries: "Delivery",
  dispatches: "Dispatch",
  farmers: "Farmer",
  farms: "Farm",
  field_events: "Field event",
  field_visits: "Field visit",
  files: "Document",
  input_advances: "Advance",
  market_prices: "Market price",
  qc_tests: "QC test",
  settlements: "Settlement",
  user_roles: "User role",
};

// The column that names a record for a person, per table, in order of preference.
const NAME_COLUMNS = [
  "delivery_code",
  "contract_code",
  "settlement_code",
  "batch_code",
  "dispatch_code",
  "farmer_code",
  "farm_code",
  "full_name",
  "farm_name",
  "name",
  "stage",
  "test_type",
  "role",
];

// Bookkeeping columns that change on every write and say nothing.
const NOISE = new Set(["updated_at", "created_at", "id"]);

type Row = Record<string, unknown>;
type Diff = Record<string, { old: unknown; new: unknown }>;

const isObject = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);

export function tableLabel(table: string): string {
  return TABLE_LABELS[table] ?? table.replace(/_/g, " ");
}

export function actorLabel(e: Pick<AuditEntry, "actor_email" | "actor_roles">): string {
  if (!e.actor_email) return "System (server job)";
  return e.actor_roles ? `${e.actor_email} (${e.actor_roles.replace(/_/g, " ")})` : e.actor_email;
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "empty";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v.length > 48 ? `${v.slice(0, 45)}...` : v;
  return JSON.stringify(v).slice(0, 48);
}

function fieldLabel(key: string): string {
  return key.replace(/_id$/, "").replace(/_/g, " ");
}

/** A short name for the record, from whatever identifying column the change carries. */
export function recordName(e: AuditEntry): string {
  if (e.row_label) return e.row_label;
  const c = e.changes;
  if (isObject(c)) {
    for (const k of NAME_COLUMNS) {
      const v = c[k];
      if (typeof v === "string" && v) return v;
      if (isObject(v)) {
        const now = (v as { new?: unknown; old?: unknown }).new ?? (v as { old?: unknown }).old;
        if (typeof now === "string" && now) return now;
      }
    }
  }
  return e.row_id ? e.row_id.slice(0, 8) : "";
}

/** One line per changed field for an update; a one-line summary for an insert or delete. */
export function describeChanges(e: AuditEntry): string[] {
  const c = e.changes;
  if (!isObject(c)) return [];
  if (e.action === "update") {
    return Object.entries(c as Diff)
      .filter(([k]) => !NOISE.has(k))
      .map(([k, d]) => `${fieldLabel(k)}: ${formatValue(d?.old)} → ${formatValue(d?.new)}`);
  }
  const name = recordName(e);
  const verb = e.action === "insert" ? "Added" : "Deleted";
  return [`${verb} ${tableLabel(e.table_name).toLowerCase()}${name ? ` ${name}` : ""}`];
}

/** True when the update touched a posted fact, i.e. it was a correction only an admin may make. */
export function isCorrection(e: AuditEntry, locked: Partial<Record<string, readonly string[]>>): boolean {
  if (e.action !== "update" || !isObject(e.changes)) return false;
  const cols = locked[e.table_name];
  return !!cols && Object.keys(e.changes).some((k) => cols.includes(k));
}
