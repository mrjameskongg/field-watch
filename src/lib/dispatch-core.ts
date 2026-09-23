// Pure dispatch math + validation. Dispatches are append-only movements
// (ERP layer design 2026-08-29): a dispatch exists or it doesn't — no drafts,
// no edits. Corrections are reversing entries (or an admin delete of a
// same-day mistake).

import { round2 } from "./trade-core";

export const DISPATCH_PRODUCTS = ["milled_output", "broken", "bran", "husk"] as const;
export type DispatchProduct = (typeof DISPATCH_PRODUCTS)[number];

export type DispatchLite = {
  product: string;
  weight_kg: number;
  price_per_kg: number | null;
};

export function isDispatchProduct(v: string): v is DispatchProduct {
  return (DISPATCH_PRODUCTS as readonly string[]).includes(v);
}

/** DP-<year>-<zero-padded seq>, following the DL-/CT- house pattern. */
export function nextDispatchCode(existingCodes: string[], year: number): string {
  const prefix = `DP-${year}-`;
  let max = 0;
  for (const code of existingCodes) {
    if (!code.startsWith(prefix)) continue;
    const n = parseInt(code.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

/** kg dispatched per product. Unknown product strings are ignored. */
export function dispatchedByProduct(dispatches: DispatchLite[]): Record<DispatchProduct, number> {
  const totals: Record<DispatchProduct, number> = {
    milled_output: 0,
    broken: 0,
    bran: 0,
    husk: 0,
  };
  for (const d of dispatches) {
    if (isDispatchProduct(d.product)) totals[d.product] = round2(totals[d.product] + d.weight_kg);
  }
  return totals;
}

/** Revenue of priced dispatches only; unpriced ones are counted separately. */
export function dispatchRevenue(dispatches: DispatchLite[]): { revenue: number; unpricedCount: number } {
  let revenue = 0;
  let unpricedCount = 0;
  for (const d of dispatches) {
    if (d.price_per_kg === null || d.price_per_kg === undefined) unpricedCount++;
    else revenue = round2(revenue + d.weight_kg * d.price_per_kg);
  }
  return { revenue, unpricedCount };
}

export type DispatchDraft = {
  buyerId: string;
  product: string;
  weightKg: number;
  pricePerKg: number | null;
};

/** Returns an i18n-able error key, or null when valid. */
export function validateDispatch(d: DispatchDraft, onHandKg: number): string | null {
  if (!d.buyerId) return "dispatch.errBuyer";
  if (!isDispatchProduct(d.product)) return "dispatch.errProduct";
  if (!(d.weightKg > 0)) return "dispatch.errWeight";
  if (d.pricePerKg !== null && d.pricePerKg < 0) return "dispatch.errPrice";
  if (d.weightKg > onHandKg) return "dispatch.errOverStock";
  return null;
}
