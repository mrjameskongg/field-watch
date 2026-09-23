-- Sentinel-2 vegetation (NDVI) and water (NDMI) readings, one row per parcel
-- per clean satellite pass. Written only by the health-scan edge function
-- (service role); everyone signed in can read.
--
-- Cloudy passes are not stored at all (the function drops anything over 40%
-- cloud inside the parcel), so a gap in this table means "no usable satellite
-- pass", which is what the UI reports.

CREATE TABLE IF NOT EXISTS public.parcel_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  reading_date DATE NOT NULL,
  ndvi_mean DOUBLE PRECISION NOT NULL,
  ndmi_mean DOUBLE PRECISION NOT NULL,
  cloud_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT parcel_health_unique_pass UNIQUE (farm_id, reading_date)
);

-- Every read is "latest readings for this parcel" or "latest reading per parcel".
CREATE INDEX IF NOT EXISTS parcel_health_farm_date_idx
  ON public.parcel_health (farm_id, reading_date DESC);

ALTER TABLE public.parcel_health ENABLE ROW LEVEL SECURITY;

-- Read for anyone signed in; no INSERT/UPDATE/DELETE policy exists on purpose,
-- so only the service role (the edge function) can write.
CREATE POLICY "Authenticated users can view parcel health"
  ON public.parcel_health FOR SELECT TO authenticated USING (true);
