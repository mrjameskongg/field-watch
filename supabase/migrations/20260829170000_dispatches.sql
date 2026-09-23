-- Dispatch/sales v2 (ERP layer design 2026-08-29): buyers + append-only
-- dispatch movements. Stock stays derived: batch outputs minus dispatches.
-- LAW: dispatches are append-only — no UPDATE policy, no UPDATE grant.
-- Corrections are reversing entries; admin/manager may delete a mistake.

CREATE TABLE IF NOT EXISTS public.buyers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_code TEXT NOT NULL UNIQUE,
  buyer_id UUID NOT NULL REFERENCES public.buyers(id) ON DELETE RESTRICT,
  product TEXT NOT NULL CHECK (product IN ('milled_output','broken','bran','husk')),
  weight_kg NUMERIC NOT NULL CHECK (weight_kg > 0),
  price_per_kg NUMERIC CHECK (price_per_kg >= 0),
  dispatched_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  recorded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dispatches_product_idx ON public.dispatches (product, dispatched_date DESC);
CREATE INDEX IF NOT EXISTS dispatches_buyer_idx ON public.dispatches (buyer_id);

ALTER TABLE public.buyers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view buyers"
  ON public.buyers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert buyers"
  ON public.buyers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update buyers"
  ON public.buyers FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Admins/managers can delete buyers"
  ON public.buyers FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

CREATE POLICY "Authenticated users can view dispatches"
  ON public.dispatches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert dispatches"
  ON public.dispatches FOR INSERT TO authenticated WITH CHECK (true);
-- intentionally NO update policy: append-only
CREATE POLICY "Admins/managers can delete dispatches"
  ON public.dispatches FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.buyers TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.dispatches TO authenticated;
GRANT ALL ON public.buyers TO service_role;
GRANT ALL ON public.dispatches TO service_role;
