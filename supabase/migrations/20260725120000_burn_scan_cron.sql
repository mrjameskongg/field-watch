-- Hourly satellite burn scan.
--
-- Without this, hotspots are only found when somebody opens the app, so an
-- overnight burn is discovered the next morning. pg_cron calls the burn-scan
-- edge function every hour; the function itself is idempotent (it dedupes on
-- a hotspot marker), so an extra run never duplicates alerts.
--
-- Before running this file, replace the two placeholders below:
--   <PROJECT_REF>   your Supabase project ref (the subdomain of the API URL)
--   <CRON_SECRET>   the same value set as the CRON_SECRET function secret
-- and deploy the function first:  supabase functions deploy burn-scan

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Re-running this file replaces the schedule instead of stacking duplicates.
SELECT cron.unschedule('burn-scan-hourly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'burn-scan-hourly');

SELECT cron.schedule(
  'burn-scan-hourly',
  '7 * * * *', -- 7 past the hour, off the top-of-hour rush on FIRMS
  $$
  SELECT net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/burn-scan',
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-cron-secret',  '<CRON_SECRET>'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- Useful checks:
--   SELECT * FROM cron.job WHERE jobname = 'burn-scan-hourly';
--   SELECT status, return_message, start_time
--     FROM cron.job_run_details
--    WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'burn-scan-hourly')
--    ORDER BY start_time DESC LIMIT 10;
