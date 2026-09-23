// Row caps for list screens.
//
// PostgREST answers an unbounded select with at most its own server-side cap
// (1000 rows by default) and says nothing about having done so. A page that
// hits it does not look broken — it looks like a shorter list, and a total
// counted from those rows is simply wrong. map.tsx already carries a note
// about this trap for parcel_health; this is the same fix everywhere else.
//
// The trick is to ask for one row more than will be shown. If that extra row
// comes back, more exist, and the screen can say so instead of quietly lying.

export const ROW_CAP = 500;
export const FETCH_LIMIT = ROW_CAP + 1;

export type Capped<T> = { rows: T[]; truncated: boolean };

/** Trim the probe row and report whether it was there. */
export function capped<T>(data: T[] | null | undefined): Capped<T> {
  const rows = data ?? [];
  return rows.length > ROW_CAP
    ? { rows: rows.slice(0, ROW_CAP), truncated: true }
    : { rows, truncated: false };
}
