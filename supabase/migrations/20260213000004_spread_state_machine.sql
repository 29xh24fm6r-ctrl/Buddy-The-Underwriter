-- Spread Rendering State Machine (Buddy Vision)
--
-- Adds state machine columns to deal_spreads for:
--   queued → generating → ready | error
-- with run_id ownership (CAS guard), structured error codes,
-- and timing metadata for observer auto-heal.

-- 1) New columns
ALTER TABLE deal_spreads
  ADD COLUMN IF NOT EXISTS started_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finished_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_run_id        UUID,
  ADD COLUMN IF NOT EXISTS error_code         TEXT,
  ADD COLUMN IF NOT EXISTS error_details_json JSONB,
  ADD COLUMN IF NOT EXISTS attempts           INT NOT NULL DEFAULT 0;

-- 2) Backfill terminal spreads
UPDATE deal_spreads SET finished_at = updated_at
WHERE status IN ('ready', 'error') AND finished_at IS NULL;

UPDATE deal_spreads SET error_code = 'LEGACY'
WHERE status = 'error' AND error_code IS NULL AND error IS NOT NULL;

-- 3) Indexes for observer timeout queries and CAS lookups
CREATE INDEX IF NOT EXISTS idx_deal_spreads_generating_started
  ON deal_spreads(started_at) WHERE status = 'generating';

CREATE INDEX IF NOT EXISTS idx_deal_spreads_last_run_id
  ON deal_spreads(last_run_id) WHERE last_run_id IS NOT NULL;

-- 4) CHECK constraint on status (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deal_spreads_status_check'
  ) THEN
    ALTER TABLE deal_spreads
      ADD CONSTRAINT deal_spreads_status_check
      CHECK (status IN ('queued', 'generating', 'ready', 'error'));
  END IF;
END $$;

COMMENT ON COLUMN deal_spreads.started_at IS 'When the worker began rendering this spread.';
COMMENT ON COLUMN deal_spreads.finished_at IS 'When the spread reached a terminal state (ready/error).';
COMMENT ON COLUMN deal_spreads.last_run_id IS 'UUID of the job run that owns this spread. CAS guard for state transitions.';
COMMENT ON COLUMN deal_spreads.error_code IS 'Structured error code (TEMPLATE_NOT_FOUND, MISSING_UPSTREAM_FACTS, RENDER_EXCEPTION, TIMEOUT, LEGACY).';
COMMENT ON COLUMN deal_spreads.error_details_json IS 'Structured error details for examiner-grade diagnostics.';
COMMENT ON COLUMN deal_spreads.attempts IS 'Number of render attempts for this spread.';
