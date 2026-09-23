-- Weekly Sentinel-2 health scan.
--
-- Sentinel-2 passes roughly every 5 days and half of them are cloudy, so once a
-- week is enough to keep every parcel current without burning quota. The
-- function is idempotent — it only asks for days after the newest stored
-- reading, and alerts dedupe on an [S2 ...] marker — so an extra run is safe.
--
-- Before running this file, replace the two placeholders below:
--   <PROJECT_REF>   your Supabase project ref (the subdomain of the API URL)
--   <CRON_SECRET>   the same value set as the CRON_SECRET function secret
-- and deploy the function first:  supabase functions deploy health-scan

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Re-running this file replaces the schedule instead of stacking duplicates.
SELECT cron.unschedule('health-scan-weekly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'health-scan-weekly');

SELECT cron.schedule(
  'health-scan-weekly',
  '20 2 * * 1', -- Mondays 02:20 UTC (09:20 Phnom Penh), after the night's passes land
  $$
  SELECT net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/health-scan',
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-cron-secret',  '<CRON_SECRET>'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- Useful checks:
--   SELECT * FROM cron.job WHERE jobname = 'health-scan-weekly';
--   SELECT status, return_message, start_time
--     FROM cron.job_run_details
--    WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'health-scan-weekly')
--    ORDER BY start_time DESC LIMIT 10;
