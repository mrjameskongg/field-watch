-- Roles, append-only posted records, and an audit log.
--
-- The proposal (4 Sep 2026) promised five staff roles and a public view,
-- enforced in the database, with records append-only below Admin and every
-- correction logged. This file delivers that:
--
--   1. role_allows(): the one question every policy asks. For the public demo
--      account it answers for the role picked in the demo's "View as" switch
--      (sent as the x-demo-role request header), so a visitor can watch the
--      database change what each role sees. The demo stays read-only either
--      way (20260831190000_demo_readonly.sql).
--   2. Restrictive policies per table, generated from src/lib/roles-core.ts
--      (npm run gen:policies). Restrictive policies AND with the existing
--      permissive ones, so this only narrows access.
--   3. lock_posted_facts(): once a delivery, test, weigh point, advance or
--      settlement exists, only an admin may change its facts.
--   4. audit_log: every insert, update and delete on business tables, with who
--      did it and what changed. Readable by admins only; nobody can edit it.
--
-- Depends on 20260923140000_roles_enum.sql, 20260923120000_member_gate.sql and
-- 20260923130000_demo_sees_seed_only.sql.

-- 1. Role checks -------------------------------------------------------------

-- The role the demo is viewing as. Defaults to manager: the office view the
-- demo has always shown.
create or replace function public.demo_view_role()
returns public.app_role
language plpgsql stable
as $$
declare
  h text;
  r text;
begin
  if not public.is_demo() then
    return null;
  end if;
  h := nullif(current_setting('request.headers', true), '');
  r := case when h is null then null else h::json ->> 'x-demo-role' end;
  if r is null or r not in ('admin', 'manager', 'field_officer', 'warehouse', 'quality_officer') then
    return 'manager';
  end if;
  return r::public.app_role;
end $$;

create or replace function public.role_allows(allowed public.app_role[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when public.is_demo() then public.demo_view_role() = any (allowed)
    else exists (select 1 from public.user_roles where user_id = auth.uid() and role = any (allowed))
  end
$$;

revoke all on function public.role_allows(public.app_role[]) from public;
grant execute on function public.role_allows(public.app_role[]) to authenticated;
grant execute on function public.demo_view_role() to authenticated;

-- 2. Posted facts are append-only below Admin --------------------------------

create or replace function public.lock_posted_facts()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  col text;
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
begin
  -- Server jobs and migrations run without a user and are not corrections.
  if auth.uid() is null or public.role_allows('{admin}'::public.app_role[]) then
    return new;
  end if;
  foreach col in array tg_argv loop
    if (o -> col) is distinct from (n -> col) then
      raise exception 'Only an admin can correct % on a posted % record. The correction is logged.', col, tg_table_name
        using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

-- 3. Audit log ---------------------------------------------------------------

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  actor_roles text,
  table_name text not null,
  row_id text,
  -- A code or name a person recognises (DL-2026-101, CT-2026-001, Chan Sophea).
  row_label text,
  action text not null check (action in ('insert', 'update', 'delete')),
  changes jsonb not null default '{}'::jsonb,
  -- Set when the row belongs to the demo's synthetic farmers, so the demo can
  -- show real audit entries without ever showing a real farmer's.
  demo_visible boolean not null default false
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_row_idx on public.audit_log (table_name, row_id);

alter table public.audit_log enable row level security;
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log
  for select to authenticated
  using ((select public.role_allows('{admin}'::public.app_role[])) and (not public.is_demo() or demo_visible));

drop policy if exists member_gate on public.audit_log;
create policy member_gate on public.audit_log
  as restrictive for all to authenticated
  using (public.is_member()) with check (public.is_member());

create or replace function public.demo_row_visible(t text, r jsonb)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(case t
    when 'farmers'            then public.demo_farmer((r ->> 'id')::uuid)
    when 'farms'              then public.demo_farmer((r ->> 'farmer_id')::uuid)
    when 'contracts'          then public.demo_farmer((r ->> 'farmer_id')::uuid)
    when 'input_advances'     then public.demo_contract((r ->> 'contract_id')::uuid)
    when 'settlements'        then public.demo_contract((r ->> 'contract_id')::uuid)
    when 'deliveries'         then public.demo_contract((r ->> 'contract_id')::uuid)
    when 'qc_tests'           then case
                                     when r ->> 'delivery_id' is not null then public.demo_delivery((r ->> 'delivery_id')::uuid)
                                     when r ->> 'batch_id' is not null then public.demo_batch((r ->> 'batch_id')::uuid)
                                   end
    when 'batches'            then public.demo_batch((r ->> 'id')::uuid)
    when 'batch_weigh_points' then public.demo_batch((r ->> 'batch_id')::uuid)
    when 'field_visits'       then public.demo_farm((r ->> 'farm_id')::uuid)
    when 'crop_cycles'        then public.demo_farm((r ->> 'farm_id')::uuid)
    when 'field_events'       then public.demo_farm((r ->> 'farm_id')::uuid)
    when 'alerts'             then case
                                     when r ->> 'farm_id' is not null then public.demo_farm((r ->> 'farm_id')::uuid)
                                     when r ->> 'farmer_id' is not null then public.demo_farmer((r ->> 'farmer_id')::uuid)
                                   end
  end, false)
$$;

create or replace function public.audit_row()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  o jsonb;
  n jsonb;
  ch jsonb;
  r jsonb;
begin
  if tg_op = 'INSERT' then
    n := to_jsonb(new); r := n; ch := n;
  elsif tg_op = 'DELETE' then
    o := to_jsonb(old); r := o; ch := o;
  else
    o := to_jsonb(old); n := to_jsonb(new); r := n;
    select coalesce(jsonb_object_agg(e.key, jsonb_build_object('old', o -> e.key, 'new', e.value)), '{}'::jsonb)
      into ch
      from jsonb_each(n) e
     where e.key <> 'updated_at' and (o -> e.key) is distinct from e.value;
    if ch = '{}'::jsonb then
      return null;
    end if;
  end if;
  insert into public.audit_log (actor_id, actor_email, actor_roles, table_name, row_id, row_label, action, changes, demo_visible)
  values (
    auth.uid(),
    auth.jwt() ->> 'email',
    (select string_agg(ur.role::text, ',' order by ur.role) from public.user_roles ur where ur.user_id = auth.uid()),
    tg_table_name,
    r ->> 'id',
    coalesce(r ->> 'delivery_code', r ->> 'contract_code', r ->> 'settlement_code', r ->> 'batch_code',
             r ->> 'dispatch_code', r ->> 'farmer_code', r ->> 'farm_code', r ->> 'full_name', r ->> 'farm_name',
             r ->> 'name', r ->> 'stage', r ->> 'test_type', r ->> 'role',
             -- Guarded cast: an audit failure must never roll back the write it records.
             case when r ->> 'farm_id' ~* '^[0-9a-f-]{36}$'
                  then (select f.farm_name from public.farms f where f.id = (r ->> 'farm_id')::uuid) end),
    lower(tg_op),
    ch,
    public.demo_row_visible(tg_table_name, r)
  );
  return null;
end $$;

-- 4. Per-table policies and triggers -----------------------------------------
-- Generated from src/lib/roles-core.ts by `npm run gen:policies`. Do not edit
-- by hand: src/lib/roles-core.test.ts fails if this block drifts.

-- BEGIN GENERATED (roles-core.ts)
-- alerts
drop policy if exists role_read on public.alerts;
drop policy if exists role_insert on public.alerts;
drop policy if exists role_update on public.alerts;
drop policy if exists role_delete on public.alerts;
create policy role_insert on public.alerts as restrictive for insert to authenticated with check ((select public.role_allows('{admin,manager,field_officer}'::public.app_role[])));
create policy role_update on public.alerts as restrictive for update to authenticated using ((select public.role_allows('{admin,manager,field_officer}'::public.app_role[]))) with check ((select public.role_allows('{admin,manager,field_officer}'::public.app_role[])));
create policy role_delete on public.alerts as restrictive for delete to authenticated using ((select public.role_allows('{admin}'::public.app_role[])));
-- app_settings
drop policy if exists role_read on public.app_settings;
drop policy if exists role_insert on public.app_settings;
drop policy if exists role_update on public.app_settings;
drop policy if exists role_delete on public.app_settings;
create policy role_insert on public.app_settings as restrictive for insert to authenticated with check ((select public.role_allows('{admin}'::public.app_role[])));
create policy role_update on public.app_settings as restrictive for update to authenticated using ((select public.role_allows('{admin}'::public.app_role[]))) with check ((select public.role_allows('{admin}'::public.app_role[])));
create policy role_delete on public.app_settings as restrictive for delete to authenticated using ((select public.role_allows('{admin}'::public.app_role[])));
-- audit_log
drop policy if exists role_read on public.audit_log;
drop policy if exists role_insert on public.audit_log;
drop policy if exists role_update on public.audit_log;
drop policy if exists role_delete on public.audit_log;
create policy role_read on public.audit_log as restrictive for select to authenticated using ((select public.role_allows('{admin}'::public.app_role[])));
create policy role_insert on public.audit_log as restrictive for insert to authenticated with check (false);
create policy role_update on public.audit_log as restrictive for update to authenticated using (false) with check (false);
create policy role_delete on public.audit_log as restrictive for delete to authenticated using (false);
-- batch_weigh_points
drop policy if exists role_read on public.batch_weigh_points;
drop policy if exists role_insert on public.batch_weigh_points;
drop policy if exists role_update on public.batch_weigh_points;
drop policy if exists role_delete on public.batch_weigh_points;
create policy role_insert on public.batch_weigh_points as restrictive for insert to authenticated with check ((select public.role_allows('{admin,manager,warehouse}'::public.app_role[])));
create policy role_update on public.batch_weigh_points as restrictive for update to authenticated using ((select public.role_allows('{admin,manager,warehouse}'::public.app_role[]))) with check ((select public.role_allows('{admin,manager,warehouse}'::public.app_role[])));
create policy role_delete on public.batch_weigh_points as restrictive for delete to authenticated using ((select public.role_allows('{admin}'::public.app_role[])));
-- batches
drop policy if exists role_read on public.batches;
drop policy if exists role_insert on public.batches;
drop policy if exists role_update on public.batches;
drop policy if exists role_delete on public.batches;
create policy role_insert on public.batches as restrictive for insert to authenticated with check ((select public.role_allows('{admin,manager,warehouse}'::public.app_role[])));
create policy role_update on public.batches as restrictive for update to authenticated using ((select public.role_allows('{admin,manager,warehouse}'::public.app_role[]))) with check ((select public.role_allows('{admin,manager,warehouse}'::public.app_role[])));
create policy role_delete on public.batches as restrictive for delete to authenticated using ((select public.role_allows('{admin}'::public.app_role[])));
-- buyers
drop policy if exists role_read on public.buyers;
drop policy if exists role_insert on public.buyers;
drop policy if exists role_update on public.buyers;
drop policy if exists role_delete on public.buyers;
create policy role_insert on public.buyers as restrictive for insert to authenticated with check ((select public.role_allows('{admin,manager}'::public.app_role[])));
create policy role_update on public.buyers as restrictive for update to authenticated using ((select public.role_allows('{admin,manager}'::public.app_role[]))) with check ((select public.role_allows('{admin,manager}'::public.app_role[])));
create policy role_delete on public.buyers as restrictive for delete to authenticated using ((select public.role_allows('{admin}'::public.app_role[])));
-- contracts
drop policy if exists role_read on public.contracts;
drop policy if exists role_insert on public.contracts;
drop policy if exists role_update on public.contracts;
drop policy if exists role_delete on public.contracts;
create policy role_insert on public.contracts as restrictive for insert to authenticated with check ((select public.role_allows('{admin,manager}'::public.app_role[])));
create policy role_update on public.contracts as restrictive for update to authenticated using ((select public.role_allows('{admin,manager}'::public.app_role[]))) with check ((select public.role_allows('{admin,manager}'::public.app_role[])));
create policy role_delete on public.contracts as restrictive for delete to authenticated using ((select public.role_allows('{admin}'::public.app_role[])));
-- crop_cycles
drop policy if exists role_read on public.crop_cycles;
drop policy if exists role_insert on public.crop_cycles;
drop policy if exists role_update on public.crop_cycles;
drop policy if exists role_delete on public.crop_cycles;
create policy role_insert on public.crop_cycles as restrictive for insert to authenticated with check ((select public.role_allows('{admin,manager,field_officer}'::public.app_role[])));
create policy role_update on public.crop_cycles as restrictive for update to authenticated using ((select public.role_allows('{admin,manager,field_officer}'::public.app_role[]))) with check ((select public.role_allows('{admin,manager,field_officer}'::public.app_role[])));
create policy role_delete on public.crop_cycles as restrictive for delete to authenticated using ((select public.role_allows('{admin}'::public.app_role[])));
-- deliveries
drop policy if exists role_read on public.deliveries;
drop policy if exists role_insert on public.deliveries;
drop policy if exists role_update on public.deliveries;
drop policy if exists role_delete on public.deliveries;
create policy role_insert on public.deliveries as restrictive for insert to authenticated with check ((select public.role_allows('{admin,manager,warehouse,field_officer}'::public.app_role[])));
create policy role_update on public.deliveries as restrictive for update to authenticated using ((select public.role_allows('{admin,manager,warehouse,field_officer}'::public.app_role[]))) with check ((select public.role_allows('{admin,manager,warehouse,field_officer}'::public.app_role[])));
create policy role_delete on public.deliveries as restrictive for delete to authenticated using ((select public.role_allows('{admin}'::public.app_role[])));
-- dispatches
drop policy if exists role_read on public.dispatches;
drop policy if exists role_insert on public.dispatches;
drop policy if exists role_update on public.dispatches;
drop policy if exists role_delete on public.dispatches;
create policy role_insert on public.dispatches as restrictive for insert to authenticated with check ((select public.role_allows('{admin,manager,warehouse}'::public.app_role[])));
create policy role_update on public.dispatches as restrictive for update to authenticated using ((select public.role_allows('{admin,manager,warehouse}'::public.app_role[]))) with check ((select public.role_allows('{admin,manager,warehouse}'::public.app_role[])));
create policy role_delete on public.dispatches as restrictive for delete to authenticated using ((select public.role_allows('{admin}'::public.app_role[])));
-- farmers
drop policy if exists role_read on public.farmers;
drop policy if exists role_insert on public.farmers;
drop policy if exists role_update on public.farmers;
drop policy if exists role_delete on public.farmers;
create policy role_insert on public.farmers as restrictive for insert to authenticated with check ((select public.role_allows('{admin,manager,field_officer}'::public.app_role[])));
create policy role_update on public.farmers as restrictive for update to authenticated using ((select public.role_allows('{admin,manager,field_officer}'::public.app_role[]))) with check ((select public.role_allows('{admin,manager,field_officer}'::public.app_role[])));
create policy role_delete on public.farmers as restrictive for delete to authenticated using ((select public.role_allows('{admin}'::public.app_role[])));
-- farms
drop policy if exists role_read on public.farms;
drop policy if exists role_insert on public.farms;
drop policy if exists role_update on public.farms;
drop policy if exists role_delete on public.farms;
create policy role_insert on public.farms as restrictive for insert to authenticated with check ((select public.role_allows('{admin,manager,field_officer}'::public.app_role[])));
create policy role_update on public.farms as restrictive for update to authenticated using ((select public.role_allows('{admin,manager,field_officer}'::public.app_role[]))) with check ((select public.role_allows('{admin,manager,field_officer}'::public.app_role[])));
create policy role_delete on public.farms as restrictive for delete to authenticated using ((select public.role_allows('{admin}'::public.app_role[])));
-- field_events
drop policy if exists role_read on public.field_events;
drop policy if exists role_insert on public.field_events;
drop policy if exists role_update on public.field_events;
drop policy if exists role_delete on public.field_events;
create policy role_insert on public.field_events as restrictive for insert to authenticated with check ((select public.role_allows('{admin,manager,field_officer}'::public.app_role[])));
create policy role_update on public.field_events as restrictive for update to authenticated using ((select public.role_allows('{admin,manager,field_officer}'::public.app_role[]))) with check ((select public.role_allows('{admin,manager,field_officer}'::public.app_role[])));
create policy role_delete on public.field_events as restrictive for delete to authenticated using ((select public.role_allows('{admin}'::public.app_role[])));
-- field_visits
drop policy if exists role_read on public.field_visits;
drop policy if exists role_insert on public.field_visits;
drop policy if exists role_update on public.field_visits;
drop policy if exists role_delete on public.field_visits;
create policy role_insert on public.field_visits as restrictive for insert to authenticated with check ((select public.role_allows('{admin,manager,field_officer}'::public.app_role[])));
create policy role_update on public.field_visits as restrictive for update to authenticated using ((select public.role_allows('{admin,manager,field_officer}'::public.app_role[]))) with check ((select public.role_allows('{admin,manager,field_officer}'::public.app_role[])));
create policy role_delete on public.field_visits as restrictive for delete to authenticated using ((select public.role_allows('{admin}'::public.app_role[])));
-- files
drop policy if exists role_read on public.files;
drop policy if exists role_insert on public.files;
drop policy if exists role_update on public.files;
drop policy if exists role_delete on public.files;
create policy role_insert on public.files as restrictive for insert to authenticated with check ((select public.role_allows('{admin,manager,field_officer}'::public.app_role[])));
create policy role_update on public.files as restrictive for update to authenticated using ((select public.role_allows('{admin,manager,field_officer}'::public.app_role[]))) with check ((select public.role_allows('{admin,manager,field_officer}'::public.app_role[])));
create policy role_delete on public.files as restrictive for delete to authenticated using ((select public.role_allows('{admin}'::public.app_role[])));
-- input_advances
drop policy if exists role_read on public.input_advances;
drop policy if exists role_insert on public.input_advances;
drop policy if exists role_update on public.input_advances;
drop policy if exists role_delete on public.input_advances;
create policy role_read on public.input_advances as restrictive for select to authenticated using ((select public.role_allows('{admin,manager,field_officer}'::public.app_role[])));
create policy role_insert on public.input_advances as restrictive for insert to authenticated with check ((select public.role_allows('{admin,manager}'::public.app_role[])));
create policy role_update on public.input_advances as restrictive for update to authenticated using ((select public.role_allows('{admin,manager}'::public.app_role[]))) with check ((select public.role_allows('{admin,manager}'::public.app_role[])));
create policy role_delete on public.input_advances as restrictive for delete to authenticated using ((select public.role_allows('{admin}'::public.app_role[])));
-- market_prices
drop policy if exists role_read on public.market_prices;
drop policy if exists role_insert on public.market_prices;
drop policy if exists role_update on public.market_prices;
drop policy if exists role_delete on public.market_prices;
create policy role_read on public.market_prices as restrictive for select to authenticated using ((select public.role_allows('{admin,manager,field_officer}'::public.app_role[])));
create policy role_insert on public.market_prices as restrictive for insert to authenticated with check ((select public.role_allows('{admin,manager}'::public.app_role[])));
create policy role_update on public.market_prices as restrictive for update to authenticated using ((select public.role_allows('{admin,manager}'::public.app_role[]))) with check ((select public.role_allows('{admin,manager}'::public.app_role[])));
create policy role_delete on public.market_prices as restrictive for delete to authenticated using ((select public.role_allows('{admin}'::public.app_role[])));
-- parcel_health
drop policy if exists role_read on public.parcel_health;
drop policy if exists role_insert on public.parcel_health;
drop policy if exists role_update on public.parcel_health;
drop policy if exists role_delete on public.parcel_health;
create policy role_insert on public.parcel_health as restrictive for insert to authenticated with check ((select public.role_allows('{admin,manager}'::public.app_role[])));
create policy role_update on public.parcel_health as restrictive for update to authenticated using ((select public.role_allows('{admin,manager}'::public.app_role[]))) with check ((select public.role_allows('{admin,manager}'::public.app_role[])));
create policy role_delete on public.parcel_health as restrictive for delete to authenticated using ((select public.role_allows('{admin}'::public.app_role[])));
-- parcel_water
drop policy if exists role_read on public.parcel_water;
drop policy if exists role_insert on public.parcel_water;
drop policy if exists role_update on public.parcel_water;
drop policy if exists role_delete on public.parcel_water;
create policy role_insert on public.parcel_water as restrictive for insert to authenticated with check ((select public.role_allows('{admin,manager}'::public.app_role[])));
create policy role_update on public.parcel_water as restrictive for update to authenticated using ((select public.role_allows('{admin,manager}'::public.app_role[]))) with check ((select public.role_allows('{admin,manager}'::public.app_role[])));
create policy role_delete on public.parcel_water as restrictive for delete to authenticated using ((select public.role_allows('{admin}'::public.app_role[])));
-- qc_tests
drop policy if exists role_read on public.qc_tests;
drop policy if exists role_insert on public.qc_tests;
drop policy if exists role_update on public.qc_tests;
drop policy if exists role_delete on public.qc_tests;
create policy role_insert on public.qc_tests as restrictive for insert to authenticated with check ((select public.role_allows('{admin,manager,quality_officer,warehouse}'::public.app_role[])));
create policy role_update on public.qc_tests as restrictive for update to authenticated using ((select public.role_allows('{admin,manager,quality_officer,warehouse}'::public.app_role[]))) with check ((select public.role_allows('{admin,manager,quality_officer,warehouse}'::public.app_role[])));
create policy role_delete on public.qc_tests as restrictive for delete to authenticated using ((select public.role_allows('{admin}'::public.app_role[])));
-- settlements
drop policy if exists role_read on public.settlements;
drop policy if exists role_insert on public.settlements;
drop policy if exists role_update on public.settlements;
drop policy if exists role_delete on public.settlements;
create policy role_read on public.settlements as restrictive for select to authenticated using ((select public.role_allows('{admin,manager}'::public.app_role[])));
create policy role_insert on public.settlements as restrictive for insert to authenticated with check ((select public.role_allows('{admin,manager}'::public.app_role[])));
create policy role_update on public.settlements as restrictive for update to authenticated using ((select public.role_allows('{admin,manager}'::public.app_role[]))) with check ((select public.role_allows('{admin,manager}'::public.app_role[])));
create policy role_delete on public.settlements as restrictive for delete to authenticated using ((select public.role_allows('{admin}'::public.app_role[])));
-- user_roles
drop policy if exists role_read on public.user_roles;
drop policy if exists role_insert on public.user_roles;
drop policy if exists role_update on public.user_roles;
drop policy if exists role_delete on public.user_roles;
create policy role_insert on public.user_roles as restrictive for insert to authenticated with check ((select public.role_allows('{admin}'::public.app_role[])));
create policy role_update on public.user_roles as restrictive for update to authenticated using ((select public.role_allows('{admin}'::public.app_role[]))) with check ((select public.role_allows('{admin}'::public.app_role[])));
create policy role_delete on public.user_roles as restrictive for delete to authenticated using ((select public.role_allows('{admin}'::public.app_role[])));

-- Posted facts: only an admin may change these columns once a row exists.
drop trigger if exists lock_posted_facts on public.deliveries;
create trigger lock_posted_facts before update on public.deliveries for each row execute function public.lock_posted_facts('delivery_code', 'contract_id', 'received_date', 'gross_weight_kg', 'bag_count', 'moisture_pct', 'price_per_kg_applied');
drop trigger if exists lock_posted_facts on public.qc_tests;
create trigger lock_posted_facts before update on public.qc_tests for each row execute function public.lock_posted_facts('delivery_id', 'batch_id', 'test_type', 'result_value', 'result_text', 'passed', 'tested_date');
drop trigger if exists lock_posted_facts on public.batch_weigh_points;
create trigger lock_posted_facts before update on public.batch_weigh_points for each row execute function public.lock_posted_facts('batch_id', 'stage', 'weight_kg', 'moisture_pct', 'estimated', 'bag_count', 'recorded_date');
drop trigger if exists lock_posted_facts on public.input_advances;
create trigger lock_posted_facts before update on public.input_advances for each row execute function public.lock_posted_facts('contract_id', 'item_type', 'quantity', 'unit_cost', 'total_cost', 'date_issued', 'deduct_at_settlement');
drop trigger if exists lock_posted_facts on public.settlements;
create trigger lock_posted_facts before update on public.settlements for each row execute function public.lock_posted_facts('settlement_code', 'contract_id', 'gross_value', 'total_deductions', 'net_payment');

-- Audit trail.
drop trigger if exists audit_row on public.app_settings;
create trigger audit_row after insert or update or delete on public.app_settings for each row execute function public.audit_row();
drop trigger if exists audit_row on public.batch_weigh_points;
create trigger audit_row after insert or update or delete on public.batch_weigh_points for each row execute function public.audit_row();
drop trigger if exists audit_row on public.batches;
create trigger audit_row after insert or update or delete on public.batches for each row execute function public.audit_row();
drop trigger if exists audit_row on public.buyers;
create trigger audit_row after insert or update or delete on public.buyers for each row execute function public.audit_row();
drop trigger if exists audit_row on public.contracts;
create trigger audit_row after insert or update or delete on public.contracts for each row execute function public.audit_row();
drop trigger if exists audit_row on public.crop_cycles;
create trigger audit_row after insert or update or delete on public.crop_cycles for each row execute function public.audit_row();
drop trigger if exists audit_row on public.deliveries;
create trigger audit_row after insert or update or delete on public.deliveries for each row execute function public.audit_row();
drop trigger if exists audit_row on public.dispatches;
create trigger audit_row after insert or update or delete on public.dispatches for each row execute function public.audit_row();
drop trigger if exists audit_row on public.farmers;
create trigger audit_row after insert or update or delete on public.farmers for each row execute function public.audit_row();
drop trigger if exists audit_row on public.farms;
create trigger audit_row after insert or update or delete on public.farms for each row execute function public.audit_row();
drop trigger if exists audit_row on public.field_events;
create trigger audit_row after insert or update or delete on public.field_events for each row execute function public.audit_row();
drop trigger if exists audit_row on public.field_visits;
create trigger audit_row after insert or update or delete on public.field_visits for each row execute function public.audit_row();
drop trigger if exists audit_row on public.files;
create trigger audit_row after insert or update or delete on public.files for each row execute function public.audit_row();
drop trigger if exists audit_row on public.input_advances;
create trigger audit_row after insert or update or delete on public.input_advances for each row execute function public.audit_row();
drop trigger if exists audit_row on public.market_prices;
create trigger audit_row after insert or update or delete on public.market_prices for each row execute function public.audit_row();
drop trigger if exists audit_row on public.qc_tests;
create trigger audit_row after insert or update or delete on public.qc_tests for each row execute function public.audit_row();
drop trigger if exists audit_row on public.settlements;
create trigger audit_row after insert or update or delete on public.settlements for each row execute function public.audit_row();
drop trigger if exists audit_row on public.user_roles;
create trigger audit_row after insert or update or delete on public.user_roles for each row execute function public.audit_row();
drop trigger if exists audit_row on public.alerts;
create trigger audit_row after update or delete on public.alerts for each row execute function public.audit_row();
-- END GENERATED (roles-core.ts)
