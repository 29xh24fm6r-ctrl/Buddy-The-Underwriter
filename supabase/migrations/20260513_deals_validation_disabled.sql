-- SPEC-EXTRACT-VALIDATOR-WIRE-1 (rev 2) §4 — validation_disabled escape hatch
--
-- Adds a per-deal boolean flag that suppresses post-extraction IRS identity
-- validation when true. Read by runPostExtractionValidation itself (the
-- validator's self-gate 1) so the flag applies uniformly across every call
-- path — current (finalizeExtractionRun) and future (backfill script, any
-- new wire-up).
--
-- Use only for deals where the validator is producing false positives that
-- block legitimate underwriting. Default false (validation runs).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.
--
-- Applied out-of-band via Supabase MCP execute_sql prior to this file
-- landing in the repo; this file exists for dev/staging parity and future
-- reproduction. See specs/SPEC-EXTRACT-VALIDATOR-WIRE-1.md §4.

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS validation_disabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.deals.validation_disabled IS
  'When true, skips post-extraction IRS identity validation. Use only for deals '
  'where the validator is producing false positives that block legitimate '
  'underwriting. Default false. The validator self-gates on this column, so the '
  'flag applies uniformly across all call paths.';
