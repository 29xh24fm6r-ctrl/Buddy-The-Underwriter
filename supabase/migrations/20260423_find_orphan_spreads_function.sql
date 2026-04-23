-- STUCK-SPREADS Batch 1 (2026-04-23)
-- Adds find_orphan_spreads(stale_threshold_minutes) — identifies deal_spreads
-- rows stuck in 'queued' with no backing active job.
-- Consumed by src/lib/spreads/janitor/cleanupOrphanSpreads.ts

CREATE OR REPLACE FUNCTION find_orphan_spreads(
  stale_threshold_minutes INTEGER DEFAULT 5
)
RETURNS TABLE(id UUID, deal_id UUID, bank_id UUID, spread_type TEXT) AS $$
  SELECT s.id, s.deal_id, s.bank_id, s.spread_type
  FROM deal_spreads s
  WHERE s.status = 'queued'
    AND s.started_at IS NULL
    AND s.updated_at < NOW() - (stale_threshold_minutes || ' minutes')::interval
    AND NOT EXISTS (
      SELECT 1 FROM deal_spread_jobs j
      WHERE j.deal_id = s.deal_id
        AND j.bank_id = s.bank_id
        AND j.status IN ('QUEUED', 'RUNNING')
    );
$$ LANGUAGE sql STABLE;
