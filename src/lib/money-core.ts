// Money formatting for a two-currency ledger. Currency is a property of the
// CONTRACT; deliveries, advances and settlements inherit it through their
// contract join. No supabase, no react.

export type Currency = "USD" | "KHR";

export const DEFAULT_KHR_PER_USD = 4100;

export function asCurrency(v: unknown): Currency {
  return v === "KHR" ? "KHR" : "USD";
}

export function fmtMoney(n: number | null | undefined, currency?: Currency | null): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const cur = asCurrency(currency);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (cur === "KHR") {
    return `${sign}${Math.round(abs).toLocaleString("en-US")} ៛`;
  }
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function usdEquivalent(n: number, currency: Currency, khrPerUsd: number): number {
  if (currency === "USD") return n;
  if (!khrPerUsd || khrPerUsd <= 0) return 0;
  return n / khrPerUsd;
}

export function sumByCurrency<T>(
  rows: T[],
  amount: (r: T) => number,
  currency: (r: T) => Currency | null | undefined,
): Record<Currency, number> {
  const out: Record<Currency, number> = { USD: 0, KHR: 0 };
  for (const r of rows) out[asCurrency(currency(r))] += amount(r);
  return out;
}
