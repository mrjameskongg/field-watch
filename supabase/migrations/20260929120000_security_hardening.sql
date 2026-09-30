-- Security hardening from the 29 Sep 2026 audit.

-- 1. The public demo login must not see real buyers (names, phones), sale
--    prices or market prices. demo_sees_seed_only covered farmer-linked
--    tables only; these three have no seed rows, so the demo sees none.
do $$
declare t text;
begin
  foreach t in array array['buyers', 'dispatches', 'market_prices'] loop
    execute format('drop policy if exists demo_seed_only on public.%I', t);
    execute format(
      'create policy demo_seed_only on public.%I as restrictive for select to authenticated '
      'using (not public.is_demo())', t);
  end loop;
end $$;

-- 2. Farm and visit photos were in public buckets with a SELECT policy open to
--    anon, so anyone could list and download every farmer's photos. Members
--    only now, and never the demo. (The app does not read these buckets yet;
--    when it does, use createSignedUrl, not getPublicUrl.)
update storage.buckets set public = false where id in ('farm-photos', 'visit-photos');

drop policy if exists "Anyone can view farm photos" on storage.objects;
drop policy if exists "Anyone can view visit photos" on storage.objects;
drop policy if exists "Authenticated can view farm photos" on storage.objects;
drop policy if exists "Authenticated can view visit photos" on storage.objects;
create policy "Authenticated can view farm photos" on storage.objects
  for select to authenticated using (bucket_id = 'farm-photos');
create policy "Authenticated can view visit photos" on storage.objects
  for select to authenticated using (bucket_id = 'visit-photos');

drop policy if exists storage_demo_no_farmer_docs on storage.objects;
create policy storage_demo_no_farmer_docs on storage.objects
  as restrictive for select to authenticated
  using (not public.is_demo() or bucket_id not in ('farmer-documents', 'farm-photos', 'visit-photos'));

-- 3. "Deactivate user" updated someone else's profile under an own-row-only
--    policy, so it matched 0 rows and silently did nothing. Admins may now
--    update any profile. Access itself is removed by deleting the user's
--    user_roles rows (users.tsx), since every gate is keyed on user_roles.
drop policy if exists "Admins can update any profile" on public.profiles;
create policy "Admins can update any profile" on public.profiles
  for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- 4. Unattached burn alerts (no farm, no farmer) name the nearest real parcel
--    in their description; the demo rule let them through with `else true`.
drop policy if exists demo_seed_only on public.alerts;
create policy demo_seed_only on public.alerts
  as restrictive for select to authenticated
  using (not public.is_demo() or (case
    when farm_id is not null then public.demo_farm(farm_id)
    when farmer_id is not null then public.demo_farmer(farmer_id)
    else false end));

-- 5. The demo helpers were granted to authenticated but never revoked from
--    PUBLIC, so anon could probe them through /rpc.
revoke execute on function public.is_demo(), public.demo_farmer(uuid), public.demo_farm(uuid),
  public.demo_contract(uuid), public.demo_delivery(uuid), public.demo_batch(uuid) from public, anon;
grant execute on function public.is_demo(), public.demo_farmer(uuid), public.demo_farm(uuid),
  public.demo_contract(uuid), public.demo_delivery(uuid), public.demo_batch(uuid) to authenticated;
