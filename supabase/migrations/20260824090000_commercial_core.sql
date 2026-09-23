-- Commercial core (Phase 1, spec 2026-08-24-commercial-traceability-design.md).
-- contracts -> input_advances / deliveries -> settlements. Money is USD NUMERIC.
-- status/type/mode fields are TEXT with app-level validation, NOT enums (house rule).

CREATE TABLE IF NOT EXISTS public.contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_code TEXT NOT NULL UNIQUE,
  farmer_id UUID NOT NULL REFERENCES public.farmers(id) ON DELETE CASCADE,
  farm_id UUID REFERENCES public.farms(id) ON DELETE SET NULL,
  crop_type TEXT NOT NULL DEFAULT 'rice',
  grower_type TEXT NOT NULL DEFAULT 'outgrower',        -- 'ingrower' | 'outgrower'
  season_label TEXT NOT NULL,
  contracted_hectares NUMERIC,
  expected_yield_kg NUMERIC,
  price_mode TEXT NOT NULL DEFAULT 'market',            -- 'fixed' | 'market'
  fixed_price_per_kg NUMERIC,
  signed_date DATE DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'active',                -- 'active' | 'completed' | 'cancelled'
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contracts_farmer_idx ON public.contracts (farmer_id, signed_date DESC);

CREATE TABLE IF NOT EXISTS public.settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_code TEXT NOT NULL UNIQUE,
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  settled_date DATE NOT NULL DEFAULT CURRENT_DATE,
  gross_value NUMERIC NOT NULL DEFAULT 0,
  total_deductions NUMERIC NOT NULL DEFAULT 0,
  net_payment NUMERIC NOT NULL DEFAULT 0,
  payment_method TEXT,
  payment_reference TEXT,
  status TEXT NOT NULL DEFAULT 'draft',                 -- 'draft' | 'paid'
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS settlements_contract_idx ON public.settlements (contract_id, settled_date DESC);

CREATE TABLE IF NOT EXISTS public.input_advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL DEFAULT 'fertilizer',         -- 'seed' | 'fertilizer' | 'other'
  description TEXT,
  quantity NUMERIC,
  unit TEXT,
  unit_cost NUMERIC,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  date_issued DATE NOT NULL DEFAULT CURRENT_DATE,
  deduct_at_settlement BOOLEAN NOT NULL DEFAULT true,
  settlement_id UUID REFERENCES public.settlements(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS input_advances_contract_idx ON public.input_advances (contract_id, date_issued DESC);

CREATE TABLE IF NOT EXISTS public.market_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_date DATE NOT NULL,
  crop_type TEXT NOT NULL DEFAULT 'rice',
  price_per_kg NUMERIC NOT NULL,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (price_date, crop_type)
);

CREATE TABLE IF NOT EXISTS public.deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_code TEXT NOT NULL UNIQUE,
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  received_date DATE NOT NULL DEFAULT CURRENT_DATE,
  gross_weight_kg NUMERIC NOT NULL,
  bag_count INTEGER,
  moisture_pct NUMERIC,
  moisture_flagged BOOLEAN GENERATED ALWAYS AS (moisture_pct > 24) STORED,
  quality_notes TEXT,
  price_per_kg_applied NUMERIC NOT NULL DEFAULT 0,
  price_source TEXT NOT NULL DEFAULT 'market',          -- 'fixed' | 'market'
  received_by UUID,
  settlement_id UUID REFERENCES public.settlements(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deliveries_contract_idx ON public.deliveries (contract_id, received_date DESC);

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.input_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;

-- Same trust shape as crop_cycles: staff read/write, admin/manager delete.
-- Settlements + market_prices writes are manager/admin only (money).
CREATE POLICY "Authenticated users can view contracts"
  ON public.contracts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert contracts"
  ON public.contracts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update contracts"
  ON public.contracts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Admins/managers can delete contracts"
  ON public.contracts FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

CREATE POLICY "Authenticated users can view settlements"
  ON public.settlements FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers can insert settlements"
  ON public.settlements FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));
CREATE POLICY "Managers can update settlements"
  ON public.settlements FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));
CREATE POLICY "Admins/managers can delete settlements"
  ON public.settlements FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

CREATE POLICY "Authenticated users can view input advances"
  ON public.input_advances FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert input advances"
  ON public.input_advances FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update input advances"
  ON public.input_advances FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Admins/managers can delete input advances"
  ON public.input_advances FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

CREATE POLICY "Authenticated users can view market prices"
  ON public.market_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers can insert market prices"
  ON public.market_prices FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));
CREATE POLICY "Managers can update market prices"
  ON public.market_prices FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));
CREATE POLICY "Admins/managers can delete market prices"
  ON public.market_prices FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

CREATE POLICY "Authenticated users can view deliveries"
  ON public.deliveries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert deliveries"
  ON public.deliveries FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update deliveries"
  ON public.deliveries FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Admins/managers can delete deliveries"
  ON public.deliveries FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contracts, public.settlements,
  public.input_advances, public.market_prices, public.deliveries TO authenticated;
GRANT ALL ON public.contracts, public.settlements, public.input_advances,
  public.market_prices, public.deliveries TO service_role;
