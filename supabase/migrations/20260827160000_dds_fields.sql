-- Due-diligence fields a buyer's supply-chain team asks for and Field Watch
-- did not record: who holds the land, and who the exporting operator is.
--
-- Only land tenure needs columns. Operator identity, country and commodity
-- code are single facts about the business, so they live in app_settings
-- (already key/value JSONB) rather than repeating on every row.
--
-- TEXT with app-level validation, not enums — house rule, see
-- 20260824090000_commercial_core.sql.

ALTER TABLE public.farms ADD COLUMN IF NOT EXISTS land_tenure TEXT;      -- 'title' | 'lease' | 'customary' | 'none'
ALTER TABLE public.farms ADD COLUMN IF NOT EXISTS land_tenure_ref TEXT;  -- title or lease reference

COMMENT ON COLUMN public.farms.land_tenure IS
  'How the farmer holds this parcel. Blank means not yet asked.';

-- Seeds only. ON CONFLICT DO NOTHING so a rerun never overwrites what Settings
-- has since edited.
INSERT INTO public.app_settings (key, value) VALUES
  ('operator', '{"name":"BRM Agro Co., Ltd","address":"","tax_ref":"","country":"KH"}'::jsonb),
  ('hs_codes', '{"rice":"1006"}'::jsonb)
ON CONFLICT (key) DO NOTHING;
