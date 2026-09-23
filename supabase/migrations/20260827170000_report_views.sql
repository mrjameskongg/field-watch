-- Report aggregates as views.
--
-- reports.tsx used to select every farmer, farm and alert unfiltered and
-- reduce them in the browser, which is both the slowest and the least
-- auditable place to do arithmetic. security_invoker keeps RLS applying to the
-- caller, not the view owner — without it these views would hand every row to
-- anyone who can select from them.

CREATE OR REPLACE VIEW public.v_area_by_province
WITH (security_invoker = on) AS
SELECT
  COALESCE(province, 'Unknown')                                         AS province,
  count(*)::bigint                                                      AS farm_count,
  count(*) FILTER (WHERE boundary_geojson IS NOT NULL)::bigint          AS mapped_count,
  COALESCE(sum(area_hectares), 0)::numeric                              AS total_hectares
FROM public.farms
GROUP BY 1;

CREATE OR REPLACE VIEW public.v_delivery_by_season
WITH (security_invoker = on) AS
SELECT
  c.season_label,
  c.crop_type,
  count(d.id)::bigint                                                   AS delivery_count,
  COALESCE(sum(d.gross_weight_kg), 0)::numeric                          AS total_kg,
  COALESCE(sum(d.gross_weight_kg * d.price_per_kg_applied), 0)::numeric AS total_value
FROM public.contracts c
JOIN public.deliveries d ON d.contract_id = c.id
GROUP BY 1, 2;

CREATE OR REPLACE VIEW public.v_settlement_summary
WITH (security_invoker = on) AS
SELECT
  c.season_label,
  count(s.id)::bigint                                                   AS settlement_count,
  count(*) FILTER (WHERE s.status = 'paid')::bigint                     AS paid_count,
  count(*) FILTER (WHERE s.status = 'draft')::bigint                    AS draft_count,
  COALESCE(sum(s.gross_value), 0)::numeric                              AS gross_value,
  COALESCE(sum(s.total_deductions), 0)::numeric                         AS total_deductions,
  COALESCE(sum(s.net_payment), 0)::numeric                              AS net_payment
FROM public.settlements s
JOIN public.contracts c ON c.id = s.contract_id
GROUP BY 1;

CREATE OR REPLACE VIEW public.v_alert_summary
WITH (security_invoker = on) AS
SELECT
  alert_type,
  severity,
  status,
  count(*)::bigint                                                      AS alert_count,
  max(detected_date)                                                    AS last_detected
FROM public.alerts
GROUP BY 1, 2, 3;

GRANT SELECT ON public.v_area_by_province    TO authenticated;
GRANT SELECT ON public.v_delivery_by_season  TO authenticated;
GRANT SELECT ON public.v_settlement_summary  TO authenticated;
GRANT SELECT ON public.v_alert_summary       TO authenticated;
