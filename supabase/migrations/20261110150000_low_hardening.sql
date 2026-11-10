-- LOW hardening, 2026-11-10.
--
-- 1. Lock a paid settlement's status and payment details to admins. A manager
--    may draft a settlement and mark it paid; once paid, only an admin may
--    reopen it or change what was recorded as paid.
-- 2. An admin-only, atomic role change, so a non-atomic delete+insert from the
--    client can't strand a user with no role (or let an admin self-demote into
--    a lockout).
-- 3. Stop `anon` executing the role helper functions. They only leak role
--    facts, but anon has no business calling them.

-- 1. Paid-settlement lock -----------------------------------------------------

create or replace function public.lock_paid_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Admins (and the service role / triggers with no auth.uid()) are unrestricted.
  if auth.uid() is null or public.role_allows('{admin}'::public.app_role[]) then
    return new;
  end if;
  if old.status = 'paid' and (
       new.status           is distinct from old.status
    or new.net_payment      is distinct from old.net_payment
    or new.gross_value      is distinct from old.gross_value
    or new.total_deductions is distinct from old.total_deductions
    or new.payment_method   is distinct from old.payment_method
    or new.payment_reference is distinct from old.payment_reference
    or new.settled_date     is distinct from old.settled_date
  ) then
    raise exception 'A paid settlement is locked. Only an admin can reopen it or change its payment details.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists lock_paid_settlement on public.settlements;
create trigger lock_paid_settlement
  before update on public.settlements
  for each row execute function public.lock_paid_settlement();

revoke execute on function public.lock_paid_settlement() from public, anon;

-- 2. Atomic, admin-only role change ------------------------------------------

create or replace function public.set_user_role(target uuid, new_role public.app_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.role_allows('{admin}'::public.app_role[]) then
    raise exception 'Only an admin can change roles.' using errcode = '42501';
  end if;
  if target = auth.uid() and new_role is distinct from 'admin'::public.app_role then
    raise exception 'You cannot remove your own admin role.' using errcode = '42501';
  end if;
  delete from public.user_roles where user_id = target;
  insert into public.user_roles (user_id, role) values (target, new_role);
end;
$$;

revoke execute on function public.set_user_role(uuid, public.app_role) from public, anon;
grant execute on function public.set_user_role(uuid, public.app_role) to authenticated;

-- 3. Keep role helpers off anon ----------------------------------------------

revoke execute on function public.is_staff() from anon;
revoke execute on function public.is_member() from anon;
revoke execute on function public.role_allows(public.app_role[]) from anon;
revoke execute on function public.demo_view_role() from anon;
