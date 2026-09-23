-- Currency per contract + closed-season flag.
--
-- Davy's dry 2025/26 ledger (contracts CT-DV-*) is booked in KHR and was
-- settled on paper before the app existed: it stays farmer history and money
-- owed, but it must not appear as wet paddy waiting in the yard. Deliveries,
-- advances and settlements carry no currency of their own — they inherit it
-- through their contract, so one column is the whole change.

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD'
    CHECK (currency IN ('USD', 'KHR')),
  ADD COLUMN IF NOT EXISTS season_closed boolean NOT NULL DEFAULT false;

UPDATE public.contracts
   SET currency = 'KHR', season_closed = true
 WHERE contract_code LIKE 'CT-DV-%';

INSERT INTO public.app_settings (key, value)
VALUES ('fx', '{"khr_per_usd": 4100}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Report views gain currency so KHR and USD never sum into one number.
-- Postgres cannot insert view columns in the middle with OR REPLACE — drop first.
DROP VIEW IF EXISTS public.v_delivery_by_season;
DROP VIEW IF EXISTS public.v_settlement_summary;

CREATE VIEW public.v_delivery_by_season
WITH (security_invoker = on) AS
SELECT
  c.season_label,
  c.crop_type,
  c.currency,
  c.season_closed,
  count(d.id)::bigint                                                   AS delivery_count,
  COALESCE(sum(d.gross_weight_kg), 0)::numeric                          AS total_kg,
  COALESCE(sum(d.gross_weight_kg * d.price_per_kg_applied), 0)::numeric AS total_value
FROM public.contracts c
JOIN public.deliveries d ON d.contract_id = c.id
GROUP BY 1, 2, 3, 4;

CREATE VIEW public.v_settlement_summary
WITH (security_invoker = on) AS
SELECT
  c.season_label,
  c.currency,
  count(s.id)::bigint                                                   AS settlement_count,
  count(*) FILTER (WHERE s.status = 'paid')::bigint                     AS paid_count,
  count(*) FILTER (WHERE s.status = 'draft')::bigint                    AS draft_count,
  COALESCE(sum(s.gross_value), 0)::numeric                              AS gross_value,
  COALESCE(sum(s.total_deductions), 0)::numeric                         AS total_deductions,
  COALESCE(sum(s.net_payment), 0)::numeric                              AS net_payment
FROM public.settlements s
JOIN public.contracts c ON c.id = s.contract_id
GROUP BY 1, 2;

GRANT SELECT ON public.v_delivery_by_season TO authenticated;
GRANT SELECT ON public.v_settlement_summary TO authenticated;
