-- SPEC-FINENGINE-TIERS-6-9 (Tier 8) — enforce one active spread job per deal/bank.
--
-- enqueueSpreadRecompute dedups by reading the active (QUEUED/RUNNING) job for a
-- (deal_id, bank_id) and merging requested types into it. Before this migration
-- there was NO unique constraint backing that contract, so:
--   * two concurrent enqueues could both insert → duplicate active jobs, and
--   * the 23505 race-recovery branch in enqueueSpreadRecompute was dead code.
-- The application read was also hardened (order + limit(1)) so it no longer
-- throws once duplicates exist; this migration removes the remaining races by
-- making the DB reject a second active job.
--
-- Step 1 collapses any pre-existing duplicate active jobs (keep the OLDEST — it
-- is the one the hardened read merges into — and fail the rest) so the partial
-- unique index can be created without violating existing rows. Failed jobs are
-- terminal and ignored by the worker claim query.

BEGIN;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY deal_id, bank_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM deal_spread_jobs
  WHERE status IN ('QUEUED', 'RUNNING')
)
UPDATE deal_spread_jobs j
SET status = 'FAILED',
    updated_at = NOW()
FROM ranked
WHERE j.id = ranked.id
  AND ranked.rn > 1;

-- One active (QUEUED/RUNNING) job per (deal_id, bank_id). Terminal jobs
-- (SUCCEEDED/FAILED) are unconstrained so history accumulates freely.
CREATE UNIQUE INDEX IF NOT EXISTS deal_spread_jobs_one_active_per_deal
  ON deal_spread_jobs (deal_id, bank_id)
  WHERE status IN ('QUEUED', 'RUNNING');

COMMIT;
