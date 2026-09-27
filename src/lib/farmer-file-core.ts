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

import { fmtMoney, type Currency } from "./money-core";

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

// ---- The same five documents, told as one plain sentence each -------------
// For someone seeing the farmer for the first time (a buyer, a professor).
// Every figure comes from records; the only derived one is t/ha.

export type StoryInput = {
  name: string;
  gender: string | null;
  village: string | null;
  district: string | null;
  province: string | null;
  registrationDate: string | null;
  farms: { hectares: number | null; mapped: boolean }[];
  /** Newest live contract, or null. */
  contract: {
    crop: string;
    hectares: number | null;
    expectedKg: number | null;
    priceMode: string;
    fixedPrice: number | null;
    currency: Currency;
  } | null;
  otherLiveContracts: number;
  advances: { itemType: string; cost: number; currency: Currency }[];
  expectedKg: number;
  deliveredKg: number;
  rank: { position: number; of: number; grade: string } | null;
  loads: number;
  testedLoads: number;
  failedLoads: number;
  /** moisture_flagged loads (over 24 %) */
  wetLoads: number;
  /** Season fires near the mapped fields; null while unknown (loading or error). */
  /** `inside` = detections inside a drawn boundary; null when no field has one. */
  fires: { count: number; inside: number | null; window: string } | null;
  openBurnAlerts: number;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ordinal = (n: number) => {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
};
const listWords = (w: string[]) => (w.length > 1 ? `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}` : w[0]);

export function farmerStory(i: StoryInput): Record<DocKey, string> {
  // Pronoun only from a recorded gender; never guessed from a name.
  const g = i.gender?.toLowerCase();
  const poss = g === "female" ? "her" : g === "male" ? "his" : `${i.name}'s`;

  const place = [i.village, i.district, i.province].filter(Boolean).join(", ");
  const mapped = i.farms.filter((f) => f.mapped).length;
  const ha = Math.round(i.farms.reduce((s, f) => s + (f.hectares ?? 0), 0) * 10) / 10;
  const haText = ha ? `, ${ha} ha` : "";
  const fields =
    i.farms.length === 0
      ? "No field registered yet."
      : mapped === i.farms.length
        ? `${plural(mapped, "field")} mapped${haText}.`
        : `${plural(i.farms.length, "field")}, ${mapped} mapped${haText}.`;
  const year = i.registrationDate?.slice(0, 4);
  const bio = [`${i.name} farms in ${place || "a place not recorded yet"}.`, fields, year ? `Registered ${year}.` : ""]
    .filter(Boolean)
    .join(" ");

  let purchase = "No purchase agreement yet.";
  const c = i.contract;
  if (c) {
    const kg = c.expectedKg ? `${kgText(c.expectedKg)} of ` : "";
    const area = c.hectares
      ? ` from ${c.hectares} ha${c.expectedKg ? ` (${(c.expectedKg / c.hectares / 1000).toFixed(1)} t/ha)` : ""}`
      : "";
    const price =
      c.priceMode === "fixed" && c.fixedPrice !== null
        ? `at a fixed ${fmtMoney(c.fixedPrice, c.currency)}/kg`
        : "at the market price on the day of delivery";
    purchase = `Agreed to sell ${kg}${c.crop}${area} ${price}.`;
    if (i.otherLiveContracts) purchase += ` ${plural(i.otherLiveContracts, "more contract")} on file.`;
  }

  let lending = "No inputs on credit.";
  if (i.advances.length) {
    const byCurrency = new Map<Currency, number>();
    for (const a of i.advances) byCurrency.set(a.currency, (byCurrency.get(a.currency) ?? 0) + a.cost);
    const total = [...byCurrency].map(([cur, n]) => fmtMoney(n, cur)).join(" and ");
    const items = [...new Set(i.advances.map((a) => (a.itemType === "other" ? "other inputs" : a.itemType)))].sort();
    lending = `${total} of ${listWords(items)} on credit, taken back from ${poss} payment.`;
  }

  let receipts =
    i.deliveredKg === 0
      ? i.expectedKg > 0
        ? `Nothing delivered yet against ${kgText(i.expectedKg)} expected.`
        : "Nothing delivered yet."
      : `Delivered ${kgText(i.deliveredKg)}` +
        (i.expectedKg > 0 ? `, ${Math.round((i.deliveredKg / i.expectedKg) * 100)}% of the estimate.` : ".");
  if (i.rank) receipts += ` Ranked ${ordinal(i.rank.position)} of ${i.rank.of} this season (grade ${i.rank.grade}).`;

  const testing: string[] = [];
  if (i.loads === 0) {
    testing.push("No loads delivered yet, so nothing to test.");
  } else {
    const untested = i.loads - i.testedLoads;
    if (untested === 0 && i.failedLoads === 0) {
      testing.push(
        i.loads === 1
          ? "The load was moisture-tested and passed."
          : `${i.loads === 2 ? "Both" : `All ${i.loads}`} loads moisture-tested and passed.`,
      );
    } else {
      if (i.failedLoads) testing.push(`${plural(i.failedLoads, "load")} failed the moisture test.`);
      if (untested) testing.push(`${untested} of ${plural(i.loads, "load")} not moisture-tested yet.`);
    }
    if (i.wetLoads) testing.push(`${plural(i.wetLoads, "load")} came in over 24% moisture.`);
  }
  const fieldWord = mapped > 1 ? "fields" : "field";
  if (i.openBurnAlerts) testing.push("Open burn alert: check the field.");
  else if (mapped === 0) testing.push("Field not mapped, so the fire check cannot run.");
  else if (i.fires && i.fires.count === 0)
    testing.push(`No fire detected within 1 km of ${poss} ${fieldWord}, ${i.fires.window} (NASA FIRMS).`);
  else if (i.fires) {
    const it = mapped > 1 ? "them" : "it";
    const inside = i.fires.inside === null ? "" : `, ${i.fires.inside === 0 ? "none" : i.fires.inside} inside ${it}`;
    testing.push(
      `${plural(i.fires.count, "fire")} detected within 1 km of ${poss} ${fieldWord}${inside}, ${i.fires.window} (NASA FIRMS). The ranking counts only open burn alerts.`,
    );
  }

  return { bio, purchase, lending, receipts, testing: testing.join(" ") };
}

function kgText(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} kg`;
}

