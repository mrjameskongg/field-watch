// One CSV quoting rule for the whole app. This escaper started life private to
// compliance-core.ts; reports needed the same thing, and two copies of a
// quoting rule is two rules that drift.

/** Excel and every DDS upload tool expect quotes around anything with a comma. */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export type CsvColumn<T> = { key: string; get: (row: T) => string | number | null };

/** Header row plus one line per record, trailing newline included. */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => c.key).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(c.get(row))).join(","));
  }
  return lines.join("\n") + "\n";
}
