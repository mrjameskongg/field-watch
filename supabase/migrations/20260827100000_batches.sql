-- Batches + weigh-point ledger (Phase 3 core).
-- custody_model is per-batch (mill meeting 27 Aug 2026): 'identity_preserved'
-- (all deliveries from one farmer, never mixed) or 'mass_balance' (mixed, totals
-- reconcile). Choosing per batch avoids the schema retrofit either global choice
-- would force later.
-- Weigh points are an event ledger, not fixed columns — stages repeat and arrive
-- out of order. moisture_pct on a weigh point records humidity at that stage
-- (before/after dryer per the mill meeting), so drying loss is measured, not
-- the "estimated 20%".

CREATE TABLE IF NOT EXISTS public.batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_code TEXT NOT NULL UNIQUE,
  crop_type TEXT NOT NULL DEFAULT 'rice',
  custody_model TEXT NOT NULL DEFAULT 'identity_preserved',
  created_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'open',
  storage_location TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.batch_weigh_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  weight_kg NUMERIC NOT NULL,
  moisture_pct NUMERIC,
  recorded_date DATE NOT NULL DEFAULT CURRENT_DATE,
  recorded_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS batch_weigh_points_batch_idx
  ON public.batch_weigh_points (batch_id, recorded_date, created_at);

ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.batches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS deliveries_batch_idx ON public.deliveries (batch_id);

-- qc_tests grows a batch scope: exactly one of delivery_id / batch_id.
ALTER TABLE public.qc_tests ALTER COLUMN delivery_id DROP NOT NULL;
ALTER TABLE public.qc_tests ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.batches(id) ON DELETE CASCADE;
DO $$ BEGIN
  ALTER TABLE public.qc_tests ADD CONSTRAINT qc_tests_exactly_one_target
    CHECK ((delivery_id IS NULL) <> (batch_id IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS qc_tests_batch_idx ON public.qc_tests (batch_id, tested_date DESC);

ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_weigh_points ENABLE ROW LEVEL SECURITY;

-- Same trust shape as deliveries: authenticated view/insert/update, admin/manager delete.
CREATE POLICY "Authenticated users can view batches"
  ON public.batches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert batches"
  ON public.batches FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update batches"
  ON public.batches FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Admins/managers can delete batches"
  ON public.batches FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

CREATE POLICY "Authenticated users can view weigh points"
  ON public.batch_weigh_points FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert weigh points"
  ON public.batch_weigh_points FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update weigh points"
  ON public.batch_weigh_points FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Admins/managers can delete weigh points"
  ON public.batch_weigh_points FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.batch_weigh_points TO authenticated;
GRANT ALL ON public.batches TO service_role;
GRANT ALL ON public.batch_weigh_points TO service_role;
