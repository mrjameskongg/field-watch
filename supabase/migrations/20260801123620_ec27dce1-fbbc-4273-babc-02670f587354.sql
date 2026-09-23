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

GRANT SELECT ON public.parcel_health TO authenticated;
GRANT ALL ON public.parcel_health TO service_role;

CREATE INDEX IF NOT EXISTS parcel_health_farm_date_idx
  ON public.parcel_health (farm_id, reading_date DESC);

ALTER TABLE public.parcel_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view parcel health"
  ON public.parcel_health FOR SELECT TO authenticated USING (true);