-- Mill process flow (Mill manager's note, 8 Sep 2026).
-- A batch is one dryer run of one variety from many farmers, so the batch
-- carries the variety and the dryer, and deliveries carry the variety so the
-- floor cannot attach the wrong paddy. Jumbo bags into store are not weighed
-- (650-700 kg each, estimated): a weigh point can say so and keep the bag
-- arithmetic that produced its weight_kg. Additive, nullable, no backfill.

ALTER TABLE public.batches
  ADD COLUMN IF NOT EXISTS variety TEXT,
  ADD COLUMN IF NOT EXISTS dryer TEXT;
ALTER TABLE public.batches ALTER COLUMN custody_model SET DEFAULT 'mass_balance';

ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS variety TEXT;

ALTER TABLE public.batch_weigh_points
  ADD COLUMN IF NOT EXISTS estimated BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bag_count INTEGER,
  ADD COLUMN IF NOT EXISTS kg_per_bag NUMERIC;

CREATE INDEX IF NOT EXISTS batches_variety_idx ON public.batches (variety);
CREATE INDEX IF NOT EXISTS deliveries_variety_idx ON public.deliveries (variety);
