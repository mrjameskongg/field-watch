// Row shapes and export columns for the report views.
//
// Every column is nullable: Postgres cannot guarantee not-null through a view,
// so this matches what `supabase gen types` produces. The UI renders them with
// the num()/money() helpers, which treat null as zero.

import type { CsvColumn } from "./csv";

export type AreaByProvince = {
  province: string | null;
  farm_count: number | null;
  mapped_count: number | null;
  total_hectares: number | null;
};

export type DeliveryBySeason = {
  season_label: string | null;
  crop_type: string | null;
  currency: string | null;
  season_closed: boolean | null;
  delivery_count: number | null;
  total_kg: number | null;
  total_value: number | null;
};

export type SettlementSummary = {
  season_label: string | null;
  currency: string | null;
  settlement_count: number | null;
  paid_count: number | null;
  draft_count: number | null;
  gross_value: number | null;
  total_deductions: number | null;
  net_payment: number | null;
};

export type AlertSummary = {
  alert_type: string | null;
  severity: string | null;
  status: string | null;
  alert_count: number | null;
  last_detected: string | null;
};

const cols = <T,>(keys: (keyof T & string)[]): CsvColumn<T>[] =>
  keys.map((k) => ({ key: k, get: (row: T) => row[k] as string | number | null }));

export const REPORT_COLUMNS = {
  area: cols<AreaByProvince>(["province", "farm_count", "mapped_count", "total_hectares"]),
  deliveries: cols<DeliveryBySeason>([
    "season_label", "crop_type", "currency", "season_closed", "delivery_count", "total_kg", "total_value",
  ]),
  settlements: cols<SettlementSummary>([
    "season_label", "currency", "settlement_count", "paid_count", "draft_count",
    "gross_value", "total_deductions", "net_payment",
  ]),
  alerts: cols<AlertSummary>(["alert_type", "severity", "status", "alert_count", "last_detected"]),
};
