// Pure calculation logic for the commercial chain (contracts -> deliveries ->
// settlements). No supabase, no react — mirror of the season-core pattern.

export type PriceRow = { price_date: string; crop_type: string; price_per_kg: number };

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const fmtUsd = (n: number | null | undefined): string =>
  n === null || n === undefined
    ? "—"
    : n < 0
      ? `-$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const genCode = (prefix: string) => `${prefix}-${String(Date.now()).slice(-6)}`;

/** DB mirrors this via the moisture_flagged generated column: strictly > 24. */
export const moistureFlagged = (pct: number | null | undefined): boolean =>
  pct !== null && pct !== undefined && pct > 24;

export function latestPriceFor(prices: PriceRow[], cropType: string, onDate: string): number | null {
  const match = prices
    .filter((p) => p.crop_type === cropType && p.price_date <= onDate)
    .sort((a, b) => (a.price_date < b.price_date ? 1 : -1))[0];
  return match ? match.price_per_kg : null;
}

export const deliveryValue = (d: { gross_weight_kg: number; price_per_kg_applied: number }) =>
  round2(d.gross_weight_kg * d.price_per_kg_applied);

export function settlementMath(
  deliveries: { gross_weight_kg: number; price_per_kg_applied: number }[],
  advances: { total_cost: number; deduct_at_settlement: boolean }[],
): { gross: number; deductions: number; net: number } {
  // Sum per-line rounded values (not round2 of the raw sum) so the printed
  // slip's line items always add up to the printed gross — invoice-style
  // rounding, matching what every screen already displays per line.
  const gross = round2(deliveries.reduce((s, d) => s + deliveryValue(d), 0));
  const deductions = round2(
    advances.filter((a) => a.deduct_at_settlement).reduce((s, a) => s + a.total_cost, 0),
  );
  return { gross, deductions, net: round2(gross - deductions) };
}

/**
 * Deliveries that cannot be settled yet because no moisture (humidity) test
 * has been recorded for them. Process rule (mill meeting, 27 Aug 2026): the
 * farmer is paid at the farm gate AFTER the humidity test and BEFORE drying —
 * so settlement requires a recorded moisture test per delivery. Recorded is
 * enough; pass/fail doesn't matter (wet paddy is still bought).
 */
export function untestedDeliveryIds(
  deliveryIds: string[],
  qcTests: { delivery_id: string; test_type: string }[],
): string[] {
  const tested = new Set(qcTests.filter((t) => t.test_type === "moisture").map((t) => t.delivery_id));
  return deliveryIds.filter((id) => !tested.has(id));
}

export const performanceRatio = (
  deliveredKg: number,
  expectedKg: number | null | undefined,
): number | null => (expectedKg ? deliveredKg / expectedKg : null);
