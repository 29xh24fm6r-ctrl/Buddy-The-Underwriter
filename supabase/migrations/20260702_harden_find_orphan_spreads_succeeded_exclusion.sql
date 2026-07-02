-- SPEC-SPREAD-PIPELINE-RECOVERY-1 (2026-07-02)
-- Hardens find_orphan_spreads to stop false-positive orphaning of queued spreads
-- after a job SUCCEEDED.
--
-- Root cause (observed on deal eefd62b3): a deal_spread_jobs row SUCCEEDED at
-- 20:42, but three requested spread types (BALANCE_SHEET, CLASSIC_PDF,
-- GLOBAL_CASH_FLOW) were left in status='queued'. 18 minutes later the orphan
-- janitor marked them ORPHANED_BY_FAILED_ORCHESTRATION because the prior logic
-- only excluded spreads with an ACTIVE (QUEUED/RUNNING) backing job — a recently
-- SUCCEEDED job did not protect them.
--
-- Fix: add a second NOT EXISTS clause that excludes spreads whose deal has a
-- SUCCEEDED job within a *grace* window. The grace window is intentionally
-- DECOUPLED from the tight stale_threshold_minutes so it covers minutes-long
-- post-success rendering gaps (not just sub-threshold races) — matching the
-- "race OR rendering failure" intent of the janitor.
--
-- The old 1-arg function is dropped first: adding a defaulted second parameter
-- otherwise creates an overload, which makes the named-argument PostgREST rpc()
-- call from cleanupOrphanSpreads.ts ambiguous.

DROP FUNCTION IF EXISTS find_orphan_spreads(INTEGER);

CREATE OR REPLACE FUNCTION find_orphan_spreads(
  stale_threshold_minutes INTEGER DEFAULT 5,
  succeeded_grace_minutes INTEGER DEFAULT 360
)
RETURNS TABLE(id UUID, deal_id UUID, bank_id UUID, spread_type TEXT) AS $$
  SELECT s.id, s.deal_id, s.bank_id, s.spread_type
  FROM deal_spreads s
  WHERE s.status = 'queued'
    AND s.started_at IS NULL
    AND s.updated_at < NOW() - (stale_threshold_minutes || ' minutes')::interval
    -- Not an orphan if an active job is still working the deal.
    AND NOT EXISTS (
      SELECT 1 FROM deal_spread_jobs j
      WHERE j.deal_id = s.deal_id
        AND j.bank_id = s.bank_id
        AND j.status IN ('QUEUED', 'RUNNING')
    )
    -- SPEC-SPREAD-PIPELINE-RECOVERY-1: not an orphan if a job SUCCEEDED for this
    -- deal within the grace window. A completed job can leave requested spread
    -- types in 'queued' (post-success rendering gap / race); orphaning them is a
    -- false positive. Grace is decoupled from the stale threshold so long gaps
    -- (the observed 18-minute case) are covered.
    AND NOT EXISTS (
      SELECT 1 FROM deal_spread_jobs j
      WHERE j.deal_id = s.deal_id
        AND j.bank_id = s.bank_id
        AND j.status = 'SUCCEEDED'
        AND j.updated_at >= NOW() - (succeeded_grace_minutes || ' minutes')::interval
    );
$$ LANGUAGE sql STABLE;
