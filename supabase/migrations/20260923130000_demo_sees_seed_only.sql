-- The public demo sees demo data only.
--
-- The demo login is published on the login page. Real contract farmers
-- (names, phone numbers, national IDs, advances, payouts) live in the same
-- database, so the demo account must not be able to read them.
--
-- Deny by default: the demo sees a farmer only if that farmer is listed in
-- demo_farmers, and sees farms, contracts, money, deliveries, tests, alerts
-- and satellite rows only through a listed farmer. A real farmer added later
-- is hidden from the demo without anyone having to remember to hide it.
--
-- These are RESTRICTIVE SELECT policies that only bite when the caller is the
-- demo account; staff queries are unchanged.
--
-- Undo: drop policy demo_seed_only on each table below, and
-- storage_demo_no_farmer_docs on storage.objects.

create table if not exists public.demo_farmers (
  farmer_id uuid primary key references public.farmers(id) on delete cascade
);
alter table public.demo_farmers enable row level security;
-- No policies: only the security-definer helpers below read it.

insert into public.demo_farmers (farmer_id)
select id from public.farmers
where farmer_code in ('FRM-100215', 'FRM-100388', 'FRM-100442', 'FRM-100517', 'FRM-100563', 'FRM-BRM-OWN')
on conflict do nothing;

create or replace function public.is_demo()
returns boolean language sql stable
as $$ select coalesce(auth.jwt() ->> 'email', '') = 'demo@fieldwatch.live' $$;

create or replace function public.demo_farmer(f uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from demo_farmers where farmer_id = f) $$;

create or replace function public.demo_farm(f uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from farms x join demo_farmers d on d.farmer_id = x.farmer_id where x.id = f) $$;

create or replace function public.demo_contract(c uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from contracts x join demo_farmers d on d.farmer_id = x.farmer_id where x.id = c) $$;

create or replace function public.demo_delivery(dl uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from deliveries x where x.id = dl and public.demo_contract(x.contract_id)) $$;

-- A batch is shown only if every load in it came from a demo contract.
create or replace function public.demo_batch(b uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select not exists (
  select 1 from deliveries x where x.batch_id = b and not public.demo_contract(x.contract_id)
) $$;

grant execute on function public.is_demo(), public.demo_farmer(uuid), public.demo_farm(uuid),
  public.demo_contract(uuid), public.demo_delivery(uuid), public.demo_batch(uuid) to authenticated;

do $$
declare r record;
begin
  for r in select * from (values
    ('farmers',            'public.demo_farmer(id)'),
    ('farms',              'public.demo_farmer(farmer_id)'),
    ('contracts',          'public.demo_farmer(farmer_id)'),
    ('input_advances',     'public.demo_contract(contract_id)'),
    ('settlements',        'public.demo_contract(contract_id)'),
    ('deliveries',         'public.demo_contract(contract_id)'),
    ('qc_tests',           '(delivery_id is not null and public.demo_delivery(delivery_id)) or (batch_id is not null and public.demo_batch(batch_id))'),
    ('batches',            'public.demo_batch(id)'),
    ('batch_weigh_points', 'public.demo_batch(batch_id)'),
    ('alerts',             'case when farm_id is not null then public.demo_farm(farm_id) when farmer_id is not null then public.demo_farmer(farmer_id) else true end'),
    ('crop_cycles',        'public.demo_farm(farm_id)'),
    ('field_events',       'public.demo_farm(farm_id)'),
    ('field_visits',       'public.demo_farm(farm_id)'),
    ('parcel_health',      'public.demo_farm(farm_id)'),
    ('parcel_water',       'public.demo_farm(farm_id)'),
    ('files',              '(farmer_id is null or public.demo_farmer(farmer_id)) and (farm_id is null or public.demo_farm(farm_id))'),
    ('profiles',           'user_id = auth.uid()'),
    ('user_roles',         'user_id = auth.uid()')
  ) as t(tbl, rule)
  loop
    execute format('drop policy if exists demo_seed_only on public.%I', r.tbl);
    execute format(
      'create policy demo_seed_only on public.%I as restrictive for select to authenticated '
      'using (not public.is_demo() or (%s))', r.tbl, r.rule);
  end loop;
end $$;

-- Uploaded farmer documents (ID scans, land papers) are never shown to the demo.
drop policy if exists storage_demo_no_farmer_docs on storage.objects;
create policy storage_demo_no_farmer_docs on storage.objects
  as restrictive for select to authenticated
  using (not public.is_demo() or bucket_id <> 'farmer-documents');
