-- Unguessable QR link per batch (29 Sep 2026 audit).
-- batch_code (B26- + 6 clock digits) stays the human label on the bag, but it
-- is only ~1M values, so the public trace page can no longer look batches up
-- by it: a script could sweep every code and collect farmer names, villages
-- and farm locations. The QR carries trace_token instead: 20 random hex chars
-- (80 bits), filled per row by the volatile default, existing rows included.
alter table public.batches
  add column if not exists trace_token text not null
  default substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);

create unique index if not exists batches_trace_token_key on public.batches (trace_token);

-- The tour, system page and docs link to the demo batch. It gets a fixed,
-- readable token, but only while every load in it is demo seed data
-- (demo_batch); if real farmers' rice is in it, it keeps a random token and
-- the demo link returns "not found" instead of leaking them.
update public.batches
   set trace_token = 'demo-B26-0001'
 where batch_code = 'B26-0001' and public.demo_batch(id);
