-- Sentinel-1 SAR water readings: one row per parcel per radar pass.
-- Written only by the water-scan edge function (service role); everyone signed
-- in can read.
--
-- Unlike parcel_health there is no cloud filter, because radar sees through
-- cloud — that is the entire reason this table exists. Raw decibel values are
-- stored alongside the verdict so the thresholds in water-core.ts can be
-- retuned later without re-fetching a single scene.

CREATE TABLE IF NOT EXISTS public.parcel_water (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  reading_date DATE NOT NULL,
  vv_db DOUBLE PRECISION NOT NULL,
  vh_db DOUBLE PRECISION NOT NULL,
  state TEXT NOT NULL,          -- flooded | drained | uncertain
  confident BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT parcel_water_unique_pass UNIQUE (farm_id, reading_date)
);

CREATE INDEX IF NOT EXISTS parcel_water_farm_date_idx
  ON public.parcel_water (farm_id, reading_date DESC);

ALTER TABLE public.parcel_water ENABLE ROW LEVEL SECURITY;

-- Read for anyone signed in; no INSERT/UPDATE/DELETE policy exists on purpose,
-- so only the service role (the edge function) can write.
CREATE POLICY "Authenticated users can view parcel water"
  ON public.parcel_water FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.parcel_water TO authenticated;
GRANT ALL ON public.parcel_water TO service_role;
