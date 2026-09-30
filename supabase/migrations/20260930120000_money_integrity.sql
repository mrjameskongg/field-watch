-- Money integrity (security review 30 Sep 2026).
-- 1. A delivery or advance attached to a settlement stays attached: detaching a
--    paid delivery made it look unsettled, so the next settlement paid it twice.
-- 2. Intake price comes from the contract or market_prices, not the client.
--    Warehouse / field officers could type any price and it locked on insert.
-- 3. Settlement Telegram alerts: office roles only, never the demo, once per
--    (settlement, event). The public demo login could loop alerts into the ops chat.

-- 1. Attach once ---------------------------------------------------------------

create or replace function public.lock_settlement_link()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  -- Server jobs, migrations and admin corrections pass. Deleting a settlement
  -- (admin only) nulls the link through ON DELETE SET NULL and passes here too.
  if auth.uid() is null or public.role_allows('{admin}'::public.app_role[]) then
    return new;
  end if;
  if old.settlement_id is not null and new.settlement_id is distinct from old.settlement_id then
    raise exception 'Only an admin can detach or move a settled % record. The correction is logged.', tg_table_name
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists lock_settlement_link on public.deliveries;
create trigger lock_settlement_link before update of settlement_id on public.deliveries
  for each row execute function public.lock_settlement_link();
drop trigger if exists lock_settlement_link on public.input_advances;
create trigger lock_settlement_link before update of settlement_id on public.input_advances
  for each row execute function public.lock_settlement_link();

-- 2. Server-side intake price ----------------------------------------------------

create or replace function public.set_delivery_price()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  c record;
  p numeric;
begin
  -- Office roles may set a manual price (e.g. a quality discount), as in the UI.
  if auth.uid() is null or public.role_allows('{admin,manager}'::public.app_role[]) then
    return new;
  end if;
  select price_mode, fixed_price_per_kg, crop_type into c from contracts where id = new.contract_id;
  if c.price_mode = 'fixed' then
    new.price_per_kg_applied := coalesce(c.fixed_price_per_kg, 0);
    new.price_source := 'fixed';
  else
    -- Same rule as latestPriceFor(): latest price for the crop on or before the intake date.
    select price_per_kg into p from market_prices
      where crop_type = c.crop_type and price_date <= new.received_date
      order by price_date desc limit 1;
    -- ponytail: no price on file = 0, same as the client autofill; admin corrects it.
    new.price_per_kg_applied := coalesce(p, 0);
    new.price_source := 'market';
  end if;
  return new;
end $$;

drop trigger if exists set_delivery_price on public.deliveries;
create trigger set_delivery_price before insert on public.deliveries
  for each row execute function public.set_delivery_price();

-- 3. Settlement alert claim ------------------------------------------------------

create table if not exists public.settlement_alerts (
  settlement_id uuid not null references public.settlements(id) on delete cascade,
  event text not null check (event in ('created', 'paid')),
  sent_at timestamptz not null default now(),
  primary key (settlement_id, event)
);
alter table public.settlement_alerts enable row level security;
-- No policies: only claim_settlement_alert() (security definer) touches it.

-- True once per (settlement, event) for an office user; false for the demo,
-- other roles, and repeats.
create or replace function public.claim_settlement_alert(sid uuid, ev text)
returns boolean
language plpgsql security definer
set search_path = public
as $$
begin
  if public.is_demo() or not public.role_allows('{admin,manager}'::public.app_role[]) then
    return false;
  end if;
  insert into settlement_alerts (settlement_id, event) values (sid, ev) on conflict do nothing;
  return found;
end $$;

revoke execute on function public.claim_settlement_alert(uuid, text) from public, anon;
grant execute on function public.claim_settlement_alert(uuid, text) to authenticated;
revoke execute on function public.lock_settlement_link(), public.set_delivery_price() from public, anon;
