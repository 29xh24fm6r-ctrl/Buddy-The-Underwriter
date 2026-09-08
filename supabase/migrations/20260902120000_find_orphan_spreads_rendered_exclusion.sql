-- SPEC-SPREAD-PIPELINE-RECOVERY-2 (2026-09-02)
-- A deal_spreads row that already carries rendered_json is NOT an orphan — it
-- was rendered by a job that completed; only its status flip was lost. The
-- janitor previously errored such rows once the SUCCEEDED-job grace window
-- (360 min) lapsed, which flipped a rendered GLOBAL_CASH_FLOW to
-- ORPHANED_BY_FAILED_ORCHESTRATION and turned the deal's canonical memo status
-- to "error" (observed on deal c0f6caab: 4 rendered spreads errored at +6h01m).
--
-- Fix: exclude rendered rows from orphan detection. cleanupOrphanSpreads.ts
-- separately heals rendered-but-stale rows to 'ready' via find_rendered_stale_spreads.

DROP FUNCTION IF EXISTS find_orphan_spreads(INTEGER);
DROP FUNCTION IF EXISTS find_orphan_spreads(INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION find_orphan_spreads(
  stale_threshold_minutes INTEGER DEFAULT 5,
  succeeded_grace_minutes INTEGER DEFAULT 360
)
RETURNS TABLE(id UUID, deal_id UUID, bank_id UUID, spread_type TEXT) AS $$
  SELECT s.id, s.deal_id, s.bank_id, s.spread_type
  FROM deal_spreads s
  WHERE s.status = 'queued'
    AND s.started_at IS NULL
    AND s.rendered_json IS NULL
    AND s.updated_at < NOW() - (stale_threshold_minutes || ' minutes')::interval
    AND NOT EXISTS (
      SELECT 1 FROM deal_spread_jobs j
      WHERE j.deal_id = s.deal_id
        AND j.bank_id = s.bank_id
        AND j.status IN ('QUEUED', 'RUNNING')
    )
    AND NOT EXISTS (
      SELECT 1 FROM deal_spread_jobs j
      WHERE j.deal_id = s.deal_id
        AND j.bank_id = s.bank_id
        AND j.status = 'SUCCEEDED'
        AND j.updated_at >= NOW() - (succeeded_grace_minutes || ' minutes')::interval
    );
$$ LANGUAGE sql STABLE SET search_path = public, pg_temp;

-- Rendered-but-stale rows: rendered_json present, status never flipped to
-- 'ready', and no active job that could still be finalizing them.
CREATE OR REPLACE FUNCTION find_rendered_stale_spreads(
  stale_threshold_minutes INTEGER DEFAULT 5
)
RETURNS TABLE(id UUID, deal_id UUID, bank_id UUID, spread_type TEXT, status TEXT) AS $$
  SELECT s.id, s.deal_id, s.bank_id, s.spread_type, s.status
  FROM deal_spreads s
  WHERE s.status IN ('queued', 'generating')
    AND s.rendered_json IS NOT NULL
    AND s.updated_at < NOW() - (stale_threshold_minutes || ' minutes')::interval
    AND NOT EXISTS (
      SELECT 1 FROM deal_spread_jobs j
      WHERE j.deal_id = s.deal_id
        AND j.bank_id = s.bank_id
        AND j.status IN ('QUEUED', 'RUNNING')
    );
$$ LANGUAGE sql STABLE SET search_path = public, pg_temp;

-- One-time repair: rows the old janitor errored even though they were rendered.
UPDATE deal_spreads
SET status = 'ready',
    error = NULL,
    error_code = NULL,
    finished_at = COALESCE(finished_at, NOW()),
    updated_at = NOW()
WHERE status = 'error'
  AND error_code = 'ORPHANED_BY_FAILED_ORCHESTRATION'
  AND rendered_json IS NOT NULL;
