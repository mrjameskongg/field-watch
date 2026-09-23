-- Demo seed, 23 Sep 2026: synthetic records for the five demo contracts so
-- every module has something to show on the read-only demo account.
--
-- Every row is marked [DEMO SEED] in a visible text field. None of these
-- people exist; money figures are illustrative, not BRM's prices.
-- Settlement totals follow settlementMath() in src/lib/trade-core.ts:
-- gross = sum of per-load kg x price (rounded per line), minus advances
-- marked deduct_at_settlement.
--
-- Rerun-safe: bails out if the demo settlement already exists.

do $$
declare
  c1 uuid := '0583db9e-699f-421a-bc09-a499604f1fa6'; -- CT-2026-001 Chan Sophea, 2.4 ha
  c2 uuid := 'e6c90ce7-157f-4c94-a237-51b2f8fef91b'; -- CT-2026-002 Sok Vanna, 1.8 ha
  c3 uuid := 'e183773d-9fc0-4558-aee7-a1cb8c1869b0'; -- CT-2026-003 Prak Dara, 3.1 ha
  c4 uuid := 'e9d3bfe4-5771-4485-b71e-de2f45cf901b'; -- CT-2026-004 Keo Sreymom, 1.2 ha
  c5 uuid := '6f4aa6d3-1821-4804-ad7a-733048438e3e'; -- CT-2026-005 Meas Bopha, 2.0 ha
  st1 uuid; st4 uuid;
begin
  if exists (select 1 from public.settlements where settlement_code = 'ST-2026-001') then
    raise notice 'demo seed already applied';
    return;
  end if;

  insert into public.input_advances (contract_id, item_type, description, quantity, unit, unit_cost, total_cost, date_issued) values
    (c1, 'seed',       '[DEMO SEED] Seed paddy, Malys Angkor', 100, 'kg', 0.80,  80.00, '2026-01-06'),
    (c1, 'fertilizer', '[DEMO SEED] NPK 16-20-0 + urea',      250, 'kg', 0.62, 155.00, '2026-01-20'),
    (c2, 'seed',       '[DEMO SEED] Seed paddy, Malys Angkor',  75, 'kg', 0.80,  60.00, '2026-01-08'),
    (c2, 'fertilizer', '[DEMO SEED] NPK 16-20-0 + urea',      180, 'kg', 0.62, 111.60, '2026-01-22'),
    (c3, 'seed',       '[DEMO SEED] Seed paddy, SKO Jasmine',  125, 'kg', 0.80, 100.00, '2026-01-05'),
    (c3, 'fertilizer', '[DEMO SEED] NPK 16-20-0 + urea',      310, 'kg', 0.62, 192.20, '2026-01-19'),
    (c3, 'diesel',     '[DEMO SEED] Pump fuel',               120, 'L',  1.05, 126.00, '2026-02-16'),
    (c4, 'seed',       '[DEMO SEED] Seed paddy, Malys Angkor',  50, 'kg', 0.80,  40.00, '2026-01-12'),
    (c4, 'fertilizer', '[DEMO SEED] NPK 16-20-0 + urea',      120, 'kg', 0.62,  74.40, '2026-01-26'),
    (c5, 'fertilizer', '[DEMO SEED] NPK 16-20-0 + urea',      200, 'kg', 0.62, 124.00, '2026-01-21'),
    (c5, 'diesel',     '[DEMO SEED] Pump fuel, AWD re-flood',   60, 'L',  1.05,  63.00, '2026-02-24');

  -- CT-2026-001: DL-2026-101 (6,240 kg x 0.30 = 1,872.00) + DL-2026-102
  -- (5,980 kg x 0.30 = 1,794.00) = 3,666.00 gross; advances 235.00; net 3,431.00. Paid.
  insert into public.settlements (settlement_code, contract_id, settled_date, gross_value, total_deductions, net_payment, payment_method, payment_reference, status, notes)
  values ('ST-2026-001', c1, '2026-08-26', 3666.00, 235.00, 3431.00, 'Bank transfer', 'DEMO-0001', 'paid', '[DEMO SEED 2026-09-23]')
  returning id into st1;
  update public.deliveries set settlement_id = st1 where contract_id = c1 and delivery_code in ('DL-2026-101', 'DL-2026-102') and settlement_id is null;
  update public.input_advances set settlement_id = st1 where contract_id = c1 and settlement_id is null;

  -- CT-2026-004: DL-2026-106 (5,890 kg x 0.30 = 1,767.00); advances 114.40; net 1,652.60. Draft, awaiting payment.
  insert into public.settlements (settlement_code, contract_id, settled_date, gross_value, total_deductions, net_payment, status, notes)
  values ('ST-2026-002', c4, '2026-08-27', 1767.00, 114.40, 1652.60, 'draft', '[DEMO SEED 2026-09-23]')
  returning id into st4;
  update public.deliveries set settlement_id = st4 where contract_id = c4 and delivery_code = 'DL-2026-106' and settlement_id is null;
  update public.input_advances set settlement_id = st4 where contract_id = c4 and settlement_id is null;

  insert into public.field_visits (farm_id, farmer_id, visit_date, visit_type, crop_condition, water_condition, burn_signs_observed, pest_or_disease_observed, comments, next_action, next_visit_date)
  select x.farm_id, x.farmer_id, v.d::date, v.t::public.visit_type, v.crop, v.water, v.burn, v.pest, '[DEMO SEED] ' || v.note, v.nxt, v.nd::date
  from (values
    (c1, '2026-01-14', 'initial',   'Transplanted, even stand',        'Flooded, about 5 cm',               false, false, 'Parcel boundary walked and confirmed.',             'Check AWD tube in 3 weeks',         '2026-02-04'),
    (c1, '2026-02-05', 'routine',   'Tillering, good colour',          'Dry-down, tube reads 15 cm',         false, false, 'First AWD dry-down reached the re-flood mark.',     'Re-flood to 5 cm',                   '2026-03-05'),
    (c1, '2026-07-30', 'routine',   'Grain filling, about 85% ripe',   'Drained for harvest',                false, false, 'Harvest window agreed with farmer.',                'Harvest 15-20 Aug, book the truck',  null),
    (c2, '2026-01-16', 'initial',   'Seedlings about 12 days old',     'Flooded',                            false, false, 'Seed and fertiliser advance handed over.',          'Routine visit in 6 weeks',           '2026-03-01'),
    (c2, '2026-03-20', 'routine',   'Flowering',                       'Flooded, about 3 cm',                false, false, 'No pest pressure seen.',                            null,                                 null),
    (c3, '2026-01-12', 'initial',   'Direct seeded, patchy on west edge','Saturated',                        false, false, 'Gap-filling advised on the west edge.',             'Follow up after gap-filling',        '2026-02-10'),
    (c3, '2026-04-08', 'follow_up', 'Booting',                         'Flooded',                            false, true,  'Brown planthopper on the east edge, about 10% of hills.', 'Spray advice given, recheck in 7 days', '2026-04-15'),
    (c3, '2026-04-15', 'follow_up', 'Booting, recovering',             'Flooded',                            false, false, 'Planthopper contained after treatment.',           null,                                 null),
    (c4, '2026-01-20', 'initial',   'Land levelled, transplanting',    'Flooded',                            false, false, 'First season with the mill. Contract terms explained.', 'Routine visit in 4 weeks',     '2026-02-17'),
    (c5, '2026-03-02', 'routine',   'Tillering',                       'Second AWD dry-down, tube 15 cm',    false, false, 'AWD pilot parcel: tube reading photographed.',     'Re-flood and log the date',          '2026-03-16'),
    (c5, '2026-06-10', 'emergency', 'Heading, undamaged',              'Flooded',                            true,  false, 'Straw burning on a neighbouring field about 300 m north; nothing burnt on this parcel. Matches the satellite fire alert.', 'Remind neighbours of the no-burn clause', null)
  ) as v(cid, d, t, crop, water, burn, pest, note, nxt, nd)
  join (select c.id as cid, c.farm_id, c.farmer_id from public.contracts c) x on x.cid = v.cid;
end $$;

-- Audit examples (needs 20260923140100_roles_audit.sql). Three changes to
-- demo records so the Audit log page has something real to show. They run as
-- a labelled seed actor with no user id, so the trigger records them as
-- "demo seed (synthetic)" and never as a real person.
do $$
declare dl uuid := (select id from public.deliveries where delivery_code = 'DL-2026-107');
begin
  if exists (select 1 from public.audit_log where actor_email = 'demo seed (synthetic)') then
    raise notice 'audit examples already applied';
    return;
  end if;
  perform set_config('request.jwt.claims', '{"email": "demo seed (synthetic)", "role": "authenticated"}', true);

  update public.deliveries
     set gross_weight_kg = 5135,
         quality_notes = '[DEMO SEED] Re-weighed after the weighbridge was recalibrated'
   where id = dl and gross_weight_kg = 5140;

  insert into public.qc_tests (delivery_id, test_type, result_value, passed, tested_date, method)
  values (dl, 'moisture', 21.8, true, '2026-08-25', '[DEMO SEED] Second reading after re-weigh');

  update public.field_visits
     set next_action = 'Recheck the east edge after the next rain', next_visit_date = '2026-04-22'
   where comments like '[DEMO SEED] Planthopper contained%';
end $$;
