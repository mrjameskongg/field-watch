// Pure contract helpers: one display status per contract, and the farmer-first
// search used by the delivery intake form. No supabase, no react.

export type ContractDisplayStatus = {
  key: "cancelled" | "completed" | "season_closed" | "active" | "other";
  label: string;
};

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * The status a person should read. The database keeps `status` and
 * `season_closed` apart, which let the header show "Season closed" and
 * "Active" side by side. Here they collapse to one word in priority order:
 * cancelled, completed, season closed, active.
 */
export function contractDisplayStatus(c: { status: string; season_closed: boolean | null }): ContractDisplayStatus {
  if (c.status === "cancelled") return { key: "cancelled", label: "Cancelled" };
  if (c.status === "completed") return { key: "completed", label: "Completed" };
  if (c.status === "active" && c.season_closed) return { key: "season_closed", label: "Season closed" };
  if (c.status === "active") return { key: "active", label: "Active" };
  return { key: "other", label: cap(c.status) };
}

export type ContractSearchRow = {
  id: string;
  contract_code: string;
  season_label: string;
  farmer_name: string | null;
  farmer_code: string | null;
};

/** Lower-case and drop dashes, spaces and dots so "frm 002" finds FRM-002. */
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[\s\-._]/g, "");

/**
 * Farmer-first contract search for the weighbridge. The clerk types a name,
 * a farmer code or a contract code, in Latin or Khmer, and gets the matching
 * contracts sorted by farmer name so one farmer's seasons sit together.
 */
export function matchContracts<T extends ContractSearchRow>(rows: T[], query: string, limit = 8): T[] {
  const q = norm(query);
  const sorted = rows
    .slice()
    .sort((a, b) =>
      (a.farmer_name ?? "").localeCompare(b.farmer_name ?? "") || a.contract_code.localeCompare(b.contract_code),
    );
  const hits = q
    ? sorted.filter(
        (r) => norm(r.farmer_name).includes(q) || norm(r.farmer_code).includes(q) || norm(r.contract_code).includes(q),
      )
    : sorted;
  return hits.slice(0, limit);
}
