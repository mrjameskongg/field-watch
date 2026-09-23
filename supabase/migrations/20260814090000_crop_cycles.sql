-- Crop cycles & field events (Stage 3, spec 2026-08-01-crop-cycles-design.md).
--
-- One crop_cycles row = one parcel × one season. One field_events row = one
-- dated thing done to the parcel (planting, fertiliser, pesticide, water,
-- other). Harvest lives on the cycle, not in events.
--
-- event_type / status / water_state / unit are TEXT with app-level validation,
-- NOT enums — deliberate divergence from the base schema so we never hit the
-- enum-alteration friction again. Do not "fix" this into enums.

CREATE TABLE IF NOT EXISTS public.crop_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  season_label TEXT NOT NULL,
  crop_type crop_type,
  seed_variety TEXT,
  planting_date DATE NOT NULL,
  expected_harvest_date DATE,
  harvest_date DATE,
  yield_kg DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active season per parcel, enforced by the database, not the app.
CREATE UNIQUE INDEX IF NOT EXISTS crop_cycles_one_active_per_farm
  ON public.crop_cycles (farm_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS crop_cycles_farm_idx
  ON public.crop_cycles (farm_id, planting_date DESC);

CREATE TABLE IF NOT EXISTS public.field_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES public.crop_cycles(id) ON DELETE CASCADE,
  farm_id UUID NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  visit_id UUID REFERENCES public.field_visits(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  event_date DATE NOT NULL DEFAULT CURRENT_DATE,
  product TEXT,
  quantity DOUBLE PRECISION,
  unit TEXT,
  water_state TEXT,
  water_depth_cm DOUBLE PRECISION,
  note TEXT,
  recorded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The ledger reads "events for this cycle, newest first" and
-- "events for this parcel across seasons".
CREATE INDEX IF NOT EXISTS field_events_cycle_idx
  ON public.field_events (cycle_id, event_date DESC);
CREATE INDEX IF NOT EXISTS field_events_farm_idx
  ON public.field_events (farm_id, event_date DESC);

ALTER TABLE public.crop_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_events ENABLE ROW LEVEL SECURITY;

-- Same trust shape as farms/visits: any signed-in staff member can read and
-- write, only admin/manager can delete.
CREATE POLICY "Authenticated users can view crop cycles"
  ON public.crop_cycles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert crop cycles"
  ON public.crop_cycles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update crop cycles"
  ON public.crop_cycles FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Admins/managers can delete crop cycles"
  ON public.crop_cycles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

CREATE POLICY "Authenticated users can view field events"
  ON public.field_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert field events"
  ON public.field_events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update field events"
  ON public.field_events FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Admins/managers can delete field events"
  ON public.field_events FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crop_cycles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.field_events TO authenticated;
GRANT ALL ON public.crop_cycles TO service_role;
GRANT ALL ON public.field_events TO service_role;
