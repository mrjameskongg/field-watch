// The Farmer File: James's five procurement documents as status logic.
//
//   1. Biodata            — who the farmer is, land mapped
//   2. Purchase document  — the contract (rice type, land, expected yield, price)
//   3. Lending document   — advanced inputs (optional)
//   4. Receive documents  — deliveries, compared to the estimate
//   5. Testing            — moisture per load, land-burn watch
//
// Pure: no supabase, no react. Screens pass in what they already loaded.
// Same shape as chain-core, but per-farmer instead of per-contract.

export type DocKey = "bio" | "purchase" | "lending" | "receipts" | "testing";

/**
 * done = complete. attention = complete-ish but something is wrong (red).
 * current = the next thing to do (amber, at most one). pending = later.
 * na = not needed for this farmer (e.g. no advance taken).
 */
export type DocState = "done" | "attention" | "current" | "pending" | "na";

export type DocStatus = { key: DocKey; state: DocState; detail: string };

export const DOC_ORDER: DocKey[] = ["bio", "purchase", "lending", "receipts", "testing"];

export type FarmerFileInput = {
  phone: string | null;
  /** farms with latitude OR a drawn boundary — farm F taught us lat alone undercounts */
  mappedFarms: number;
  totalFarms: number;
  contracts: { id: string; status: string; expected_yield_kg: number | null }[];
  advanceCount: number;
  deliveries: { id: string; gross_weight_kg: number }[];
  moistureTestedDeliveryIds: Set<string>;
  /** possible_burn alerts still new/investigating */
  activeBurnAlerts: number;
};

const kg = (n: number) => `${Math.round(n).toLocaleString()} kg`;

export function farmerDocs(input: FarmerFileInput): DocStatus[] {
  const live = input.contracts.filter((c) => c.status !== "cancelled");
  const expectedKg = live.reduce((s, c) => s + (c.expected_yield_kg ?? 0), 0);
  const deliveredKg = input.deliveries.reduce((s, d) => s + d.gross_weight_kg, 0);
  const untested = input.deliveries.filter((d) => !input.moistureTestedDeliveryIds.has(d.id));

  const bioDone = Boolean(input.phone) && input.mappedFarms > 0;
  const overContract = expectedKg > 0 && deliveredKg > expectedKg;
  const testingBad = untested.length > 0 || input.activeBurnAlerts > 0;

  const raw: DocStatus[] = [
    {
      key: "bio",
      state: bioDone ? "done" : "pending",
      detail: !input.phone
        ? "No phone number"
        : input.mappedFarms === 0
          ? input.totalFarms === 0
            ? "No farm registered"
            : "Farm not mapped (no GPS or boundary)"
          : `${input.mappedFarms} mapped farm${input.mappedFarms === 1 ? "" : "s"}`,
    },
    {
      key: "purchase",
      state: live.length > 0 ? "done" : "pending",
      detail:
        live.length > 0
          ? `${live.length} contract${live.length === 1 ? "" : "s"}${expectedKg ? ` · ${kg(expectedKg)} expected` : ""}`
          : "No contract yet",
    },
    {
      key: "lending",
      state: input.advanceCount > 0 ? "done" : live.length > 0 ? "na" : "pending",
      detail:
        input.advanceCount > 0
          ? `${input.advanceCount} advance${input.advanceCount === 1 ? "" : "s"}`
          : "No advance taken",
    },
    {
      key: "receipts",
      state:
        input.deliveries.length === 0 ? "pending" : overContract ? "attention" : "done",
      detail:
        input.deliveries.length === 0
          ? "Nothing delivered yet"
          : `${kg(deliveredKg)}${expectedKg ? ` of ${kg(expectedKg)}` : ""}${overContract ? " — over contract" : ""}`,
    },
    {
      key: "testing",
      state: testingBad ? "attention" : input.deliveries.length > 0 ? "done" : "pending",
      detail:
        input.activeBurnAlerts > 0
          ? `${input.activeBurnAlerts} active burn alert${input.activeBurnAlerts === 1 ? "" : "s"}`
          : untested.length > 0
            ? `${untested.length} of ${input.deliveries.length} loads untested`
            : input.deliveries.length > 0
              ? "All loads tested"
              : "Waiting on a delivery",
    },
  ];

  // Exactly one amber: the first doc that is pending or attention takes the
  // slot. An attention doc keeps its red — it still IS the thing to fix, so
  // nothing after it may go amber.
  for (const doc of raw) {
    if (doc.state === "attention") break;
    if (doc.state === "pending") {
      doc.state = "current";
      break;
    }
  }
  return raw;
}
