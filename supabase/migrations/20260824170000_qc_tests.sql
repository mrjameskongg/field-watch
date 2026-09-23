-- QC tests table (Phase 2, delivery-scoped lab and moisture checks).
-- Links delivery -> QC metrics; batch_id joins in Phase 3.
-- status/type/method fields are TEXT with app-level validation, NOT enums (house rule).

CREATE TABLE IF NOT EXISTS public.qc_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES public.deliveries(id) ON DELETE CASCADE,
  test_type TEXT NOT NULL DEFAULT 'moisture',
  result_value NUMERIC,
  result_text TEXT,
  passed BOOLEAN,
  tested_date DATE NOT NULL DEFAULT CURRENT_DATE,
  tested_by TEXT,
  method TEXT,
  recorded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qc_tests_delivery_idx ON public.qc_tests (delivery_id, tested_date DESC);

ALTER TABLE public.qc_tests ENABLE ROW LEVEL SECURITY;

-- Same trust shape as deliveries: authenticated view/insert/update, admin/manager delete.
CREATE POLICY "Authenticated users can view qc tests"
  ON public.qc_tests FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert qc tests"
  ON public.qc_tests FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update qc tests"
  ON public.qc_tests FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Admins/managers can delete qc tests"
  ON public.qc_tests FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.qc_tests TO authenticated;
GRANT ALL ON public.qc_tests TO service_role;
