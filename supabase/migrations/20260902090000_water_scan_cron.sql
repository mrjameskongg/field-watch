-- Twice-weekly Sentinel-1 water scan.
--
-- Radar sees through cloud, so unlike the optical scan every pass is usable.
-- Sentinel-1 revisits Cambodia roughly every 6-12 days, so twice a week catches
-- each pass shortly after it lands without asking Copernicus for the same days
-- over and over — the function only requests days after the newest stored
-- reading, so an extra run is cheap and safe.
--
-- Why this exists: /water judges whether a parcel has been held flooded, and
-- that judgement is only as fresh as the last scan. Before this file, the scan
-- ran only when somebody clicked "Radar scan" on the map page, which means the
-- flags were as stale as the last person to remember.
--
-- Before running this file, replace the two placeholders below:
--   <PROJECT_REF>   your Supabase project ref (the subdomain of the API URL)
--   <CRON_SECRET>   the same value set as the CRON_SECRET function secret
-- and deploy the function first:  supabase functions deploy water-scan

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Re-running this file replaces the schedule instead of stacking duplicates.
SELECT cron.unschedule('water-scan-biweekly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'water-scan-biweekly');

SELECT cron.schedule(
  'water-scan-biweekly',
  '40 2 * * 1,4', -- Mondays and Thursdays 02:40 UTC, 20 min after the health scan slot
  $$
  SELECT net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/water-scan',
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
--   SELECT * FROM cron.job WHERE jobname = 'water-scan-biweekly';
--   SELECT status, return_message, start_time
--     FROM cron.job_run_details
--    WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'water-scan-biweekly')
--    ORDER BY start_time DESC LIMIT 10;
