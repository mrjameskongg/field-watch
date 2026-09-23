# Deployment

Field Watch is a static-plus-server-rendered front end, a Supabase database and six edge functions. This page lists what each piece needs. Secret values never go in the repository; set them as edge function secrets in the Supabase (or Lovable Cloud) dashboard.

## Front end

```bash
cp .env.example .env    # public Supabase URL + anon key only
npm ci
npm run build
```

The build output is served by the host. The only variables the browser sees are the Supabase URL, project id and anon (publishable) key. The anon key is designed to be public: every table sits behind row-level security.

## Database

Apply `supabase/migrations/*.sql` in filename order. They create the tables, row-level security policies, helper functions (`has_role`, `is_member`, `is_staff`, demo filters) and storage buckets.

Optional: `supabase/seed/demo-seed-2026-09-23.sql` adds synthetic advances, settlements and field visits for the five demo contracts. It expects the demo farmers and contracts to exist.

## Edge functions

| Function | Called by | JWT check | Secrets it reads |
|---|---|---|---|
| `burn-scan` | `pg_cron`, Alerts page | off; requires `x-cron-secret` | `FIRMS_MAP_KEY`, `CRON_SECRET`, optional `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| `health-scan` | `pg_cron` weekly, admin or manager from the map | off; accepts `x-cron-secret` or an admin/manager token | `CDSE_CLIENT_ID`, `CDSE_CLIENT_SECRET`, `CRON_SECRET` |
| `water-scan` | `pg_cron` twice a week, admin or manager from the map | off; accepts `x-cron-secret` or an admin/manager token | `CDSE_CLIENT_ID`, `CDSE_CLIENT_SECRET`, `CRON_SECRET`, optional Telegram pair |
| `trace` | public trace page | off (public by design) | none beyond the service key; returns a fixed projection with no personal data |
| `ask` | Ask page | on | `LOVABLE_API_KEY` (AI gateway); queries run with the caller's own token |
| `settlement-alert` | settlement screen | on | optional Telegram pair |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform.

Keys:

- **FIRMS:** free map key from https://firms.modaps.eosdis.nasa.gov/api/map_key/
- **Copernicus Data Space:** free OAuth client from https://dataspace.copernicus.eu (Sentinel Hub Statistical API)
- **CRON_SECRET:** any long random string; the same value goes in the function secret and in the cron job header

## Schedules

The `*_cron.sql` migrations contain `<PROJECT_REF>` and `<CRON_SECRET>` placeholders. Replace them, then run the file in the SQL editor. Each file unschedules its old job first, so re-running it replaces the schedule instead of adding a second one.

| Job | Schedule (UTC) | Function |
|---|---|---|
| `health-scan-weekly` | `20 2 * * 1` (Mondays 02:20) | Sentinel-2 vigour and moisture |
| `water-scan-biweekly` | `40 2 * * 1,4` (Mondays and Thursdays 02:40) | Sentinel-1 flooded or drained |
