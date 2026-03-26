-- Phase 55D: Credit Memo Financial Validation Metadata
-- Enriches memo snapshots with financial validation state at generation time.

ALTER TABLE IF EXISTS public.credit_memo_snapshots
  ADD COLUMN IF NOT EXISTS financial_validation_summary_json jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS financial_snapshot_id uuid,
  ADD COLUMN IF NOT EXISTS financial_snapshot_built_at timestamptz,
  ADD COLUMN IF NOT EXISTS financial_validation_hash text,
  ADD COLUMN IF NOT EXISTS decision_safe boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS memo_safe boolean DEFAULT false;
