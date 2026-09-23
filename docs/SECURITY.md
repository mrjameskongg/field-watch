# Security model

Permissions live in the database, not in the screens. The UI hides what a role cannot use so the menu stays focused, but every rule below is enforced by PostgreSQL row-level security (RLS) and triggers, so it holds for any client, including someone calling the API directly with a valid login.

## Roles

One matrix, [`src/lib/roles-core.ts`](../src/lib/roles-core.ts), drives three things: the database policies (generated into [`20260923140100_roles_audit.sql`](../supabase/migrations/20260923140100_roles_audit.sql) by `npm run gen:policies`), the sidebar, and the demo's "View as" switch. A unit test fails if the checked-in migration drifts from the matrix.

| | Admin | Manager | Field Officer | Warehouse | Quality Officer |
|---|:-:|:-:|:-:|:-:|:-:|
| Farmers, farms, visits, crop cycles, alerts: write | ✓ | ✓ | ✓ | | |
| Contracts, advances, settlements, prices: write | ✓ | ✓ | | | |
| Deliveries (intake): write | ✓ | ✓ | ✓ | ✓ | |
| Batches, weigh points, dispatches: write | ✓ | ✓ | | ✓ | |
| QC tests: write | ✓ | ✓ | | ✓ | ✓ |
| Settlements: read | ✓ | ✓ | | | |
| Advances, market prices: read | ✓ | ✓ | ✓ | | |
| Delete anything | ✓ | | | | |
| Correct a posted weight, test or amount | ✓ | | | | |
| Users, settings, audit log | ✓ | | | | |

Every other table is readable by every staff role. An account with no role reads and writes nothing ([member gate](../supabase/migrations/20260923120000_member_gate.sql)), which matters because sign-up is open.

## How it is enforced

- **Restrictive policies.** Each rule is a `RESTRICTIVE` policy, which PostgreSQL ANDs with the table's existing permissive policies. Adding one can only narrow access, never widen it.
- **One check function.** Every policy calls `role_allows(roles[])`, which looks up the caller's rows in `user_roles`. It is wrapped as `(select role_allows(...))` so it runs once per statement, not once per row.
- **Append-only posted facts.** A `BEFORE UPDATE` trigger, `lock_posted_facts`, refuses any change to a delivery's weight, moisture or price, a QC result, a weigh point, an advance amount or a settlement amount unless the caller is an admin. Workflow links (attaching a delivery to a batch or a settlement, marking a settlement paid) stay open to the roles that own them.
- **Audit log.** An `AFTER` trigger on 19 business tables writes every insert, update and delete to `audit_log`: who, their roles, when, the record, and for updates the old and new value of each changed field. Only admins can read it. Nobody can write to it through the API, admins included, because insert, update and delete privileges are revoked and every write policy is `false`.
- **Public trace.** The QR page is served by an edge function that selects a fixed set of safe columns. It never returns phone numbers, national IDs, prices or payments, and it rounds farm coordinates to about 110 m.

## The demo account

`demo@fieldwatch.live` is public by design, so it is locked down separately:

- **Read-only.** 66 restrictive policies ([`20260831190000_demo_readonly.sql`](../supabase/migrations/20260831190000_demo_readonly.sql)) refuse every insert, update and delete from it.
- **Synthetic data only.** It sees a farmer only if that farmer is on an explicit allowlist, and sees farms, contracts, money, deliveries, tests and alerts only through those farmers ([`20260923130000_demo_sees_seed_only.sql`](../supabase/migrations/20260923130000_demo_sees_seed_only.sql)). Real farmers added later are hidden automatically.
- **View as.** The header switch sends an `x-demo-role` request header. `role_allows()` honours it **only** when the caller is the demo account, so the demo can show exactly what each role would see. A real account sending the header gets its real roles and nothing more. The demo stays read-only whichever role it views as.

## Policy tests

[`supabase/tests/role_policies.sql`](../supabase/tests/role_policies.sql) creates one throwaway user per role inside a transaction, acts as each through the same `authenticated` role and JWT claims the API uses, records what the database allowed, and rolls everything back.

Result against the production database on 23 September 2026: **68 of 68 checks passed**, and nothing persisted (verified afterwards: no test users, no audit rows, the test delivery still 7,410 kg).

| Check | Admin | Manager | Field Officer | Warehouse | Quality |
|---|:-:|:-:|:-:|:-:|:-:|
| Sees settlements | yes | yes | no | no | no |
| Sees input advances | yes | yes | yes | no | no |
| Sees farmers | yes | yes | yes | yes | yes |
| Logs a field visit | ok | ok | ok | blocked | blocked |
| Records a QC test | ok | ok | blocked | ok | ok |
| Corrects a posted delivery weight | ok | blocked | blocked | blocked | 0 rows |
| Edits a delivery note (not a posted fact) | ok | ok | ok | ok | 0 rows |
| Deletes a record | ok | 0 rows | 0 rows | 0 rows | 0 rows |
| Writes the audit log directly | blocked | blocked | blocked | blocked | blocked |
| Reads the audit log | yes | no | no | no | no |

Plus: the admin's weight correction appears in the audit log with old and new values; an account with no role sees no farmers and cannot add one; and the demo, viewing as each of the five roles, sees settlements only as Admin or Manager, never sees a real farmer, and changes nothing.

"Blocked" means the database raised a permission error. "0 rows" means the row was invisible to that role, so the statement touched nothing.
