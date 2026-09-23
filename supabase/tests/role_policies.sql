-- Role policy tests, run against a real database inside one transaction that
-- is rolled back at the end: nothing it creates survives.
--
-- It creates one throwaway user per role, then acts as each of them through
-- the same `authenticated` role and JWT claims the API uses, and records what
-- the database allowed. The last SELECT is the result table; every row should
-- read pass = true.
--
-- Needs: the demo seed (supabase/seed/demo-seed-2026-09-23.sql) for rows to
-- read and change.
--
-- Run: paste into the SQL editor, or `psql -f supabase/tests/role_policies.sql`.

begin;

create temp table results (n serial, who text, check_name text, expected text, got text, pass boolean) on commit drop;
grant all on results to authenticated;
grant usage, select on sequence results_n_seq to authenticated;

create or replace function pg_temp.expect(who text, check_name text, expected text, got text) returns void
language sql as $$
  insert into results (who, check_name, expected, got, pass) values (who, check_name, expected, got, expected = got)
$$;

create or replace function pg_temp.act_as(uid uuid, email text, demo_role text default null) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'email', email, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', case when demo_role is null then '{}' else json_build_object('x-demo-role', demo_role)::text end, true);
  execute 'set local role authenticated';
end $$;

-- Tries a statement; returns 'ok', 'blocked' (RLS or trigger refused) or '0 rows'.
create or replace function pg_temp.try(stmt text) returns text
language plpgsql as $$
declare n int;
begin
  execute stmt;
  get diagnostics n = row_count;
  return case when n = 0 then '0 rows' else 'ok' end;
exception when insufficient_privilege then
  return 'blocked';
end $$;

do $$
declare
  -- Admin last: its delete must not remove the row before the others try.
  roles text[] := array['manager', 'field_officer', 'warehouse', 'quality_officer', 'admin'];
  r text;
  uid uuid;
  farm uuid := (select c.farm_id from public.contracts c where c.contract_code = 'CT-2026-002');
  farmer uuid := (select c.farmer_id from public.contracts c where c.contract_code = 'CT-2026-002');
  dl uuid := (select id from public.deliveries where delivery_code = 'DL-2026-105');
  visit uuid := (select id from public.field_visits where comments like '[DEMO SEED] No pest pressure%');
  visit2 uuid := (select id from public.field_visits where comments like '[DEMO SEED] Harvest window%');
  got text;
begin
  if farm is null or dl is null or visit is null or visit2 is null then
    raise exception 'demo seed not found; apply supabase/seed/demo-seed-2026-09-23.sql first';
  end if;

  foreach r in array roles loop
    uid := gen_random_uuid();
    insert into auth.users (id, email, aud, role) values (uid, r || '@policy-test.invalid', 'authenticated', 'authenticated');
    insert into public.user_roles (user_id, role) values (uid, r::public.app_role);

    perform pg_temp.act_as(uid, r || '@policy-test.invalid');

    -- Reads
    perform pg_temp.expect(r, 'sees settlements', case when r in ('admin', 'manager') then 'yes' else 'no' end,
      case when exists (select 1 from public.settlements) then 'yes' else 'no' end);
    perform pg_temp.expect(r, 'sees input advances', case when r in ('admin', 'manager', 'field_officer') then 'yes' else 'no' end,
      case when exists (select 1 from public.input_advances) then 'yes' else 'no' end);
    perform pg_temp.expect(r, 'sees farmers', 'yes', case when exists (select 1 from public.farmers) then 'yes' else 'no' end);

    -- Writes
    got := pg_temp.try(format(
      'insert into public.field_visits (farm_id, farmer_id, visit_type, comments) values (%L, %L, ''routine'', ''policy test'')', farm, farmer));
    perform pg_temp.expect(r, 'logs a field visit', case when r in ('admin', 'manager', 'field_officer') then 'ok' else 'blocked' end, got);

    got := pg_temp.try(format(
      'insert into public.qc_tests (delivery_id, test_type, result_value, passed, tested_date) values (%L, ''moisture'', 14.0, true, current_date)', dl));
    perform pg_temp.expect(r, 'records a QC test', case when r in ('admin', 'manager', 'quality_officer', 'warehouse') then 'ok' else 'blocked' end, got);

    got := pg_temp.try(format('update public.deliveries set gross_weight_kg = gross_weight_kg + 1 where id = %L', dl));
    perform pg_temp.expect(r, 'corrects a posted delivery weight',
      case when r = 'admin' then 'ok' when r = 'quality_officer' then '0 rows' else 'blocked' end, got);

    got := pg_temp.try(format('update public.deliveries set quality_notes = coalesce(quality_notes, '''') where id = %L', dl));
    perform pg_temp.expect(r, 'edits a delivery note (not a posted fact)',
      case when r in ('admin', 'manager', 'warehouse', 'field_officer') then 'ok' else '0 rows' end, got);

    got := pg_temp.try(format('delete from public.field_visits where id = %L', visit));
    perform pg_temp.expect(r, 'deletes a record', case when r = 'admin' then 'ok' else '0 rows' end, got);

    got := pg_temp.try('insert into public.audit_log (table_name, action) values (''x'', ''insert'')');
    perform pg_temp.expect(r, 'writes the audit log directly', 'blocked', got);

    perform pg_temp.expect(r, 'reads the audit log', case when r = 'admin' then 'yes' else 'no' end,
      case when exists (select 1 from public.audit_log where actor_id is not null) then 'yes' else 'no' end);

    execute 'reset role';
  end loop;

  -- The admin's weight correction is in the audit log with before and after.
  perform pg_temp.expect('admin', 'correction logged with old and new weight', 'yes',
    case when exists (select 1 from public.audit_log
                      where table_name = 'deliveries' and action = 'update' and row_id = dl::text
                        and changes ? 'gross_weight_kg' and actor_email = 'admin@policy-test.invalid') then 'yes' else 'no' end);

  -- An account with no role.
  uid := gen_random_uuid();
  insert into auth.users (id, email, aud, role) values (uid, 'stranger@policy-test.invalid', 'authenticated', 'authenticated');
  perform pg_temp.act_as(uid, 'stranger@policy-test.invalid');
  perform pg_temp.expect('no role', 'sees farmers', 'no', case when exists (select 1 from public.farmers) then 'yes' else 'no' end);
  got := pg_temp.try('insert into public.farmers (full_name, farmer_code) values (''x'', ''FRM-TEST'')');
  perform pg_temp.expect('no role', 'adds a farmer', 'blocked', got);
  execute 'reset role';

  -- The public demo, viewing as each role through the x-demo-role header.
  foreach r in array roles loop
    perform pg_temp.act_as('00000000-0000-0000-0000-00000000de30', 'demo@fieldwatch.live', r);
    perform pg_temp.expect('demo as ' || r, 'sees settlements', case when r in ('admin', 'manager') then 'yes' else 'no' end,
      case when exists (select 1 from public.settlements) then 'yes' else 'no' end);
    perform pg_temp.expect('demo as ' || r, 'sees a real farmer', 'no',
      case when exists (select 1 from public.farmers where farmer_code like 'FRM-DV-%') then 'yes' else 'no' end);
    got := pg_temp.try(format('update public.field_visits set comments = comments where id = %L', visit2));
    perform pg_temp.expect('demo as ' || r, 'changes anything', '0 rows', got);
    execute 'reset role';
  end loop;
end $$;

select who, check_name, expected, got, pass from results order by n;

rollback;
