-- Medium-severity hardening (audit follow-up)
--
-- M1  Storage deletes were open to any staff role (is_staff()), so a warehouse
--     or quality_officer could delete farmer ID scans and land photos with no
--     audit trail, though the files table restricts delete to admin. Align
--     storage object deletes with the "below Admin nothing is deleted" rule.
--
-- M2  demo_batch() used NOT EXISTS(non-demo delivery), which is vacuously true
--     for a batch with no deliveries yet. The public demo (via x-demo-role:admin)
--     could then read freshly created real batches, their weigh points and QC,
--     and the real farmer data later attached to them through the trace page.
--     Require at least one demo delivery before a batch is demo-visible.
--
-- M4  The "Ask your mill" function had no per-user limit. Anyone could mint a
--     demo session (public demo-login) and loop /ask to drain Lovable AI
--     credits and 429 real staff. Add a per-user daily quota, and deny the demo
--     outright. The function calls claim_ask_quota() before spending anything.

-- M1 ---------------------------------------------------------------------------
drop policy if exists storage_staff_delete on storage.objects;
create policy storage_staff_delete on storage.objects
  as restrictive for delete to authenticated
  using (public.role_allows('{admin}'::public.app_role[]));

-- M2 ---------------------------------------------------------------------------
-- A batch is demo-visible only if it has at least one demo-contract load and no
-- non-demo load. An empty batch is not visible.
create or replace function public.demo_batch(b uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from deliveries d where d.batch_id = b and public.demo_contract(d.contract_id)
  ) and not exists (
    select 1 from deliveries x where x.batch_id = b and not public.demo_contract(x.contract_id)
  )
$$;

-- M4 ---------------------------------------------------------------------------
create table if not exists public.ask_usage (
  user_id uuid not null,
  day date not null default current_date,
  n integer not null default 0,
  primary key (user_id, day)
);
alter table public.ask_usage enable row level security;
-- No policies: only claim_ask_quota() (security definer) touches it.

-- Count one question for the caller today and report whether they are still
-- under the daily cap. False for the demo, anon, and once the cap is passed.
create or replace function public.claim_ask_quota(limit_per_day integer default 50)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cur integer;
begin
  if uid is null or public.is_demo() then
    return false;
  end if;
  insert into public.ask_usage (user_id, day, n) values (uid, current_date, 1)
    on conflict (user_id, day) do update set n = public.ask_usage.n + 1
    returning n into cur;
  return cur <= limit_per_day;
end $$;

revoke execute on function public.claim_ask_quota(integer) from public, anon;
grant execute on function public.claim_ask_quota(integer) to authenticated;
