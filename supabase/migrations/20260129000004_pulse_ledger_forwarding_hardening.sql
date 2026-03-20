-- Pulse forwarder hardening: claim-based concurrency + deadletter support.
-- Follow-on to 20260129_pulse_ledger_forwarding.sql.

ALTER TABLE deal_pipeline_ledger
  ADD COLUMN IF NOT EXISTS pulse_forward_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS pulse_forward_claim_id text,
  ADD COLUMN IF NOT EXISTS pulse_forward_deadletter_at timestamptz;

-- Claim selection: unclaimed, not forwarded, not deadlettered
CREATE INDEX IF NOT EXISTS idx_ledger_pulse_unclaimed_created
  ON deal_pipeline_ledger (created_at)
  WHERE pulse_forwarded_at IS NULL
    AND pulse_forward_deadletter_at IS NULL
    AND pulse_forward_claimed_at IS NULL;

-- Health stats: failed rows in recent window
CREATE INDEX IF NOT EXISTS idx_ledger_pulse_failed_recent
  ON deal_pipeline_ledger (created_at)
  WHERE pulse_forwarded_at IS NULL
    AND pulse_forward_attempts > 0;
