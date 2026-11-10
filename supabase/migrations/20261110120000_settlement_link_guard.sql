-- Settlement-link integrity (HIGH fix)
--
-- Before: lock_settlement_link only blocked MOVING an already-settled record
-- (it fired `before update of settlement_id` and raised only when
-- old.settlement_id was not null). Two paths were left open to any role that can
-- write deliveries / input_advances (admin, manager, warehouse, field_officer):
--   1. UPDATE null -> value  (attach an unsettled load to a settlement)
--   2. INSERT with settlement_id preset
-- and neither checked that the settlement belonged to the same contract. A
-- warehouse or field_officer could run
--   update deliveries set settlement_id = '<any settlement>' where settlement_id is null;
-- so those loads read as settled, were skipped by the next settlement run, and
-- the farmer was underpaid until an admin detached them.
--
-- After: attaching a settlement_id (on INSERT or null->value UPDATE) is allowed
-- only for admin/manager AND only when the settlement's contract matches the
-- row's contract. Detaching/moving an already-settled row stays admin-only.
-- Server jobs (auth.uid() null) and admins still pass unchanged, so seeding and
-- the manager-run settlement UI (contracts page) keep working.

create or replace function public.lock_settlement_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Server jobs, migrations and admin corrections pass. An admin-only settlement
  -- delete nulls the link through ON DELETE SET NULL and also arrives here.
  if auth.uid() is null or public.role_allows('{admin}'::public.app_role[]) then
    return new;
  end if;

  -- Detaching or moving an already-settled record stays admin-only.
  if tg_op = 'UPDATE'
     and old.settlement_id is not null
     and new.settlement_id is distinct from old.settlement_id then
    raise exception 'Only an admin can detach or move a settled % record. The correction is logged.', tg_table_name
      using errcode = '42501';
  end if;

  -- Attaching to a settlement (INSERT with a value, or null -> value on UPDATE):
  -- office roles only, and the settlement must belong to the same contract.
  -- On INSERT, OLD is null, so OLD.settlement_id is null and the test below holds.
  if new.settlement_id is not null
     and new.settlement_id is distinct from old.settlement_id then
    if not public.role_allows('{admin,manager}'::public.app_role[]) then
      raise exception 'Only an admin or manager may attach a % to a settlement.', tg_table_name
        using errcode = '42501';
    end if;
    if (select s.contract_id from public.settlements s where s.id = new.settlement_id)
         is distinct from new.contract_id then
      raise exception 'Settlement and % must belong to the same contract.', tg_table_name
        using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

-- Re-create the UPDATE triggers and add the missing INSERT coverage.
drop trigger if exists lock_settlement_link on public.deliveries;
create trigger lock_settlement_link
  before update of settlement_id on public.deliveries
  for each row execute function public.lock_settlement_link();
drop trigger if exists lock_settlement_link_ins on public.deliveries;
create trigger lock_settlement_link_ins
  before insert on public.deliveries
  for each row execute function public.lock_settlement_link();

drop trigger if exists lock_settlement_link on public.input_advances;
create trigger lock_settlement_link
  before update of settlement_id on public.input_advances
  for each row execute function public.lock_settlement_link();
drop trigger if exists lock_settlement_link_ins on public.input_advances;
create trigger lock_settlement_link_ins
  before insert on public.input_advances
  for each row execute function public.lock_settlement_link();

revoke execute on function public.lock_settlement_link() from public, anon;
