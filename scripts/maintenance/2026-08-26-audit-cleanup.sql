-- One-time production cleanup for the 2026-08-26 buddysba.com audit.
--
-- NOT a migration. Nothing here changes schema; every statement deletes or
-- finalizes rows that the code fixes in this branch prevent from recurring.
-- Kept as a reviewable file rather than run ad hoc so the numbers, the
-- reasoning, and the person who ran it are all on the record.
--
-- RUN ORDER: deploy the code first. Each section is independent and safe to
-- run alone. Every DELETE is preceded by its SELECT so the count can be
-- eyeballed before committing.
--
--   docs/audits/2026-08-26-buddysba-full-system-audit.md  §5.5 §5.6 §5.7 §5.10

begin;

-- ---------------------------------------------------------------------------
-- 1. buddy_sba_scores — collapse the recompute runaway.        (audit §5.5)
--
-- 12,605 rows for 38 deals; 9,038 on one deal over ten days, one roughly
-- every 96 seconds, every one identical to its predecessor. The idempotency
-- check added in this branch (findUnchangedActiveScore) stops new ones.
--
-- Keeps, per deal: every locked row (they are decision records and must never
-- be deleted), the current active row, and the 20 most recent superseded rows
-- for history. Deletes the rest.
-- ---------------------------------------------------------------------------

-- Preview:
--   select count(*) from buddy_sba_scores;                       -- expect ~12,605
--   select count(*) from buddy_sba_scores where score_status = 'locked';  -- expect 1

with ranked as (
  select
    id,
    row_number() over (partition by deal_id order by computed_at desc) as rn,
    score_status,
    superseded_at
  from buddy_sba_scores
)
delete from buddy_sba_scores s
using ranked r
where s.id = r.id
  and r.score_status <> 'locked'      -- never delete a locked decision record
  and r.superseded_at is not null     -- never delete the current active row
  and r.rn > 20;                      -- keep the 20 most recent per deal

-- ---------------------------------------------------------------------------
-- 2. franchise_sync_runs — finalize orphaned runs.            (audit §5.10)
--
-- 5,748 rows stuck at status='running', newest from 2026-06-13. The four
-- scrapers only ever write 'complete' on their happy path and nothing sweeps
-- a run whose process died. runFranchiseSyncJanitor (nightly) now does this
-- continuously; this backfills the existing pile.
-- ---------------------------------------------------------------------------

-- Preview:
--   select source, count(*) from franchise_sync_runs
--    where status = 'running' group by 1;

update franchise_sync_runs
set status = 'failed',
    completed_at = coalesce(completed_at, now()),
    errors = coalesce(errors, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'code', 'ORPHANED_RUN',
        'message', 'Run never finalized; backfilled by the 2026-08-26 audit cleanup.'
      ))
where status = 'running'
  and started_at < now() - interval '6 hours';

commit;

-- ---------------------------------------------------------------------------
-- 3. buddy_system_events / buddy_workers — telemetry retention. (audit §5.7)
--
-- NOT run here. The purge RPCs already exist in production
-- (purge_buddy_system_events / purge_buddy_workers / purge_franchise_sync_runs,
-- from 20260729000010_telemetry_retention.sql) and runTelemetryRetentionPurge
-- already calls all three. The ONLY thing missing was a schedule: /api/cron/nightly
-- was never listed in vercel.json's `crons` array, so it had never run once.
-- That entry is added in this branch, so the first nightly run after deploy
-- reclaims the backlog on its own.
--
-- buddy_system_events was 360 MB of a 643 MB database (56%). The default
-- retention is 90 days for events and 30 for dead workers.
--
-- To reclaim immediately rather than waiting for the first nightly run:
--   select purge_buddy_system_events();   -- default keeps 90 days
--   select purge_buddy_workers();         -- default keeps 30 days of dead rows
--   select purge_franchise_sync_runs();   -- default keeps 30 days
--   vacuum (analyze) buddy_system_events; -- return the pages to the OS
