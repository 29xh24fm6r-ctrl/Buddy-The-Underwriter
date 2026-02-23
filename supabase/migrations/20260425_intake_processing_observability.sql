-- Intake Processing Observability (observability_v1)
--
-- Adds per-run tracking columns to deals for processing lifecycle visibility.
-- All nullable — pre-existing deals remain NULL (= "legacy run, no observability").

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS intake_processing_queued_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS intake_processing_started_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS intake_processing_run_id             TEXT,
  ADD COLUMN IF NOT EXISTS intake_processing_last_heartbeat_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS intake_processing_error              TEXT;
