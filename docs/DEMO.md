# Demo walkthrough

Start at https://fieldwatch.live/login?demo=1. It signs in as the read-only demo account and opens a short guided tour. Everything below uses the synthetic demo data, so buttons that would change data are refused by the database, not just hidden.

Each step says what to look at and which proposal objective it shows.

## 1. Dashboard: the mill in one screen (objectives 1, 4)

`/dashboard`

- **Paddy bought / paid / owed.** Paid is the one settled contract (CT-2026-001, $3,431.00). Owed is the value of the unpaid loads.
- **Open batch.** B26-0001: 22,830 kg received wet, 18,400 kg after drying, 18,170 kg of milled outputs. *Unaccounted: 0 kg.*
- **Needs attention.** Open satellite alerts, wet loads, failed QC tests.
- **Satellite.** How old the newest optical and radar pass is.

## 2. Map: the estate from orbit (objective 3)

`/map`

- Drag to orbit, scroll to zoom. The surveyed estate, canals and plots sit on Sentinel-2 imagery.
- *Vigour* colours each parcel by NDVI (green healthy, amber moderate, red poor). *Water* switches to the Sentinel-1 radar reading: flooded, drained or uncertain.
- The date scrubber replays the season pass by pass.

## 3. A farmer, from registration to payment (objectives 1, 4)

`/contracts` → **CT-2026-001** (Chan Sophea)

- The farmer chain: registered, contract signed, inputs advanced, delivered, humidity tested, paid, dried and batched. The only step left is milling and shipping.
- **Advances:** seed $80.00 and fertiliser $155.00, deducted at settlement.
- **Settlement ST-2026-001:** two loads, 6,240 kg and 5,980 kg at $0.30/kg = $3,666.00, minus $235.00 advances = **$3,431.00**. Same arithmetic as `settlementMath()` in `src/lib/trade-core.ts`.
- Compare **CT-2026-004**: its settlement is still a draft, waiting to be marked paid.

## 4. Field visits (objective 1)

`/visits`

- Initial, routine, follow-up and emergency visits across the five demo farms.
- 8 April, Prak Dara: brown planthopper found, follow-up on 15 April shows it contained.
- 10 June, Meas Bopha: straw burning on a neighbour's field, the ground check behind a satellite fire alert.

## 5. Intake and quality (objective 4)

`/deliveries`, `/qc`

- DL-2026-104 came in at 25.2% moisture and is flagged *wet* (over 24%). The mill still buys it, but it has to dry first.
- A load cannot be settled until a moisture test is recorded against it.

## 6. The batch: every kilogram, every stage (objective 4)

`/batches` → **B26-0001**

- Four loads from three farms, then weigh points: after drying, into the mill, and each milled output (head rice, broken, bran, husk, wastage).
- Drying loss and milling recovery are measured from those weights, not assumed.
- **Label** prints the QR code that goes on the bags.

## 7. What the buyer sees (objective 4)

Open https://fieldwatch.live/trace/B26-0001 in a private window, with no login.

- The same batch, with its weight chain, where it grew (farm points rounded to about 110 m), satellite record and radar water practice.
- No names beyond a first name, no phone numbers, IDs, prices or payments. The page is served by an edge function that only selects safe columns.
- Switch **EN / ខ្មែរ** in the header.

## 8. Evidence packs (objective 4)

`/compliance`

- One row per contract: parcels mapped, kilograms delivered, water practice from radar, and what is still missing before a buyer's due-diligence file is complete.
- **Export** writes EUDR-format GeoJSON and CSV.

## 9. Ranking and recall

- `/ranking`: farmers graded A to D on fulfilment (50), quality (30) and a clean record (20).
- `/recall`: type a batch code to get every farm in it, or a farmer to get every batch they are in.

## 10. Ask the mill (objective 1)

`/ask`

- Try *"Which deliveries failed a moisture test?"* or ask in Khmer.
- The question runs under the asker's own login, so the answer can only use data that person is allowed to see.

## 11. Security, shown in the database

- The demo account cannot write: try **Add Farmer**. The insert is refused by a row-level security policy.
- The demo account cannot see the mill's real contract farmers. They live in the same database, filtered out by [`20260923130000_demo_sees_seed_only.sql`](../supabase/migrations/20260923130000_demo_sees_seed_only.sql).
- A brand-new account with no role sees nothing at all: [`20260923120000_member_gate.sql`](../supabase/migrations/20260923120000_member_gate.sql).
