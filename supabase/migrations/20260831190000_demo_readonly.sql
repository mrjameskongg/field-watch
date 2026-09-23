-- Lock the public demo account (demo@fieldwatch.live) to read-only.
--
-- RESTRICTIVE policies AND with the existing permissive ones, so for every
-- other authenticated user nothing changes; for the demo account every
-- INSERT/UPDATE/DELETE is refused by the database itself, whatever the UI does.
-- SELECT is untouched — the demo can see everything a normal user sees.
--
-- Keyed on the JWT email claim, so no auth.users lookup is needed.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'alerts','app_settings','batch_weigh_points','batches','buyers',
    'contracts','crop_cycles','deliveries','dispatches','farmers','farms',
    'field_events','field_visits','files','input_advances','market_prices',
    'parcel_health','parcel_water','profiles','qc_tests','settlements','user_roles'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS demo_no_insert ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS demo_no_update ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS demo_no_delete ON public.%I', t);
    EXECUTE format(
      $p$CREATE POLICY demo_no_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated
         WITH CHECK (coalesce(auth.jwt() ->> 'email', '') <> 'demo@fieldwatch.live')$p$, t);
    EXECUTE format(
      $p$CREATE POLICY demo_no_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated
         USING (coalesce(auth.jwt() ->> 'email', '') <> 'demo@fieldwatch.live')$p$, t);
    EXECUTE format(
      $p$CREATE POLICY demo_no_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated
         USING (coalesce(auth.jwt() ->> 'email', '') <> 'demo@fieldwatch.live')$p$, t);
  END LOOP;
END $$;

-- Verify: expect 66 rows (22 tables x 3 policies).
-- SELECT count(*) FROM pg_policies WHERE policyname LIKE 'demo_no_%';
