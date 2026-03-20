-- Pulse telemetry forwarding columns for deal_pipeline_ledger.
-- Tracks which ledger events have been forwarded to Pulse for Claude observer visibility.
-- Safe: all columns are nullable with sane defaults, no existing data is modified.

ALTER TABLE deal_pipeline_ledger
  ADD COLUMN IF NOT EXISTS pulse_forwarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS pulse_forward_attempts integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pulse_forward_error text;

-- Index for the forwarder query: fetch un-forwarded events in chronological order.
CREATE INDEX IF NOT EXISTS idx_ledger_pulse_pending
  ON deal_pipeline_ledger (created_at ASC)
  WHERE pulse_forwarded_at IS NULL;
