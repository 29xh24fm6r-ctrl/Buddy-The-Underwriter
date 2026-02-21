-- E2 — Spread Run Ledger + Extraction Quality Status
--
-- Purpose: Observability for spread orchestration runs.
-- Each run records the preflight result and tracks execution.
-- Lean ledger: hash + blockers + status. No redundant derivable fields.

BEGIN;

-- ── Spread Run Ledger ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS deal_spread_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id),
  bank_id UUID NOT NULL,
  run_reason TEXT NOT NULL CHECK (run_reason IN (
    'intake_confirmed', 'manual', 'recompute', 'doc_change'
  )),
  status TEXT NOT NULL DEFAULT 'blocked' CHECK (status IN (
    'blocked', 'queued', 'running', 'succeeded', 'failed', 'debounced'
  )),
  preflight_blockers JSONB,
  computed_snapshot_hash TEXT,
  spread_job_id UUID,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

COMMENT ON TABLE deal_spread_runs IS 'E2: Spread orchestration run history — observability, not a model layer';

CREATE INDEX IF NOT EXISTS idx_spread_runs_deal
  ON deal_spread_runs(deal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_spread_runs_active
  ON deal_spread_runs(deal_id, status, created_at)
  WHERE status IN ('queued', 'running');

-- ── Extraction Quality Column ─────────────────────────────────────────

ALTER TABLE deal_documents
  ADD COLUMN IF NOT EXISTS extraction_quality_status TEXT
  CHECK (extraction_quality_status IN ('PASSED', 'SUSPECT'));

COMMENT ON COLUMN deal_documents.extraction_quality_status IS 'E2: Structural plausibility of extracted facts — PASSED or SUSPECT';

COMMIT;
