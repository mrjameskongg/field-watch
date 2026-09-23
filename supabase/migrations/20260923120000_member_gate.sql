-- Member gate.
--
-- Sign-up is open, and most table policies were written as
-- `TO authenticated USING (true)`: any account that could log in could read
-- and edit farmers, contracts and deliveries, including phone numbers and
-- national IDs. A fresh account has no row in user_roles, so it should see
-- nothing at all.
--
-- This adds one RESTRICTIVE policy per table. Restrictive policies are ANDed
-- with the existing permissive ones, so nothing a staff member can do today
-- changes; an account with no role now gets empty results and failed writes.
-- The public read-only demo keeps its view; its writes stay blocked by the
-- restrictive policies in 20260831190000_demo_readonly.sql.
--
-- Undo: drop policy member_gate on every public table, and the three
-- storage_* policies below.

create or replace function public.is_staff()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid())
$$;

create or replace function public.is_member()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_staff()
      or coalesce(auth.jwt() ->> 'email', '') = 'demo@fieldwatch.live'
$$;

revoke all on function public.is_staff() from public;
revoke all on function public.is_member() from public;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_member() to authenticated;

do $$
declare t text;
begin
  for t in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
  loop
    execute format('drop policy if exists member_gate on public.%I', t);
    execute format(
      'create policy member_gate on public.%I as restrictive for all to authenticated '
      'using (public.is_member()) with check (public.is_member())', t);
  end loop;
end $$;

-- Storage: farmer documents, farm photos and visit photos. Members may view;
-- only staff may upload or delete (the demo is a member but not staff).
drop policy if exists storage_member_read on storage.objects;
drop policy if exists storage_staff_write on storage.objects;
drop policy if exists storage_staff_delete on storage.objects;

create policy storage_member_read on storage.objects
  as restrictive for select to authenticated
  using (public.is_member());

create policy storage_staff_write on storage.objects
  as restrictive for insert to authenticated
  with check (public.is_staff());

create policy storage_staff_delete on storage.objects
  as restrictive for delete to authenticated
  using (public.is_staff());
