-- Restores deal_pipeline_runs — the "Make E-Tran Ready" autopilot
-- pipeline's own run-tracking table. Same untracked-migration pattern as
-- deal_truth_snapshots/agent_claims/etc: 20251227000005_deal_pipeline_runs.sql
-- is checked into this repo and recorded as applied in
-- supabase_migrations.schema_migrations, but the table (and its two
-- enums, pipeline_stage/pipeline_status) do not exist live — confirmed
-- via to_regclass/pg_type before writing this migration.
--
-- src/lib/autopilot/orchestrator.ts's startAutopilotRun()/
-- executeAutopilotPipeline() are real, substantial, already-correct code
-- (S1-S9 stage runner) that simply had no table to write its run records
-- into. This migration restores schema parity only — it does not add the
-- separate policy_pack/loan_product columns from
-- 20251227000007_dual_policy_mode.sql, since nothing in the autopilot
-- pipeline code reads or writes those columns (confirmed by grep) and
-- that migration's much larger scope (deals.loan_product/primary_policy_pack/
-- secondary_policy_pack, a policy_pack_configurations table) is a separate,
-- adjacent gap, also apparently unapplied, left undisturbed here.
--
-- Uses the deny-all + explicit service-role-only RLS policy already
-- established for the arbitration tables (20260718000009), not the
-- original migration's `current_setting('app.current_bank_id')` SELECT
-- policy — that pattern requires application code to SET a session GUC
-- that nothing in this codebase actually sets, making it either
-- permanently-false or reliant on infrastructure that doesn't exist; it's
-- exactly the kind of fragile RLS pattern the 2026-05 hardening pass
-- (rls_service_role_zero_policy_tables, fix_auth_rls_initplan_wrap_auth_calls)
-- was targeting, and is plausibly why this table got dropped in the first
-- place. All real consumers (orchestrator.ts, autopilot/status route) use
-- supabaseAdmin() (service role, bypasses RLS) exclusively.

DO $$ BEGIN
  CREATE TYPE pipeline_stage AS ENUM (
    'S1_INTAKE',
    'S2_AGENTS',
    'S3_CLAIMS',
    'S4_OVERLAYS',
    'S5_ARBITRATION',
    'S6_TRUTH',
    'S7_CONDITIONS',
    'S8_NARRATIVE',
    'S9_PACKAGE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE pipeline_status AS ENUM (
    'queued',
    'running',
    'succeeded',
    'failed',
    'canceled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS deal_pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES banks(id) ON DELETE CASCADE,

  status pipeline_status NOT NULL DEFAULT 'queued',
  current_stage pipeline_stage DEFAULT 'S1_INTAKE',
  progress numeric(5,2) NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),

  mode text NOT NULL DEFAULT 'full' CHECK (mode IN ('full', 'fast')),
  force_rerun boolean NOT NULL DEFAULT false,

  stage_logs jsonb NOT NULL DEFAULT '[]'::jsonb,

  error_json jsonb,
  error_stage pipeline_stage,

  truth_snapshot_id uuid REFERENCES deal_truth_snapshots(id),
  package_bundle_id uuid,

  started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,

  triggered_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_pipeline_runs_deal_id ON deal_pipeline_runs(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_pipeline_runs_bank_id ON deal_pipeline_runs(bank_id);
CREATE INDEX IF NOT EXISTS idx_deal_pipeline_runs_status ON deal_pipeline_runs(status);
CREATE INDEX IF NOT EXISTS idx_deal_pipeline_runs_created_at ON deal_pipeline_runs(created_at DESC);

ALTER TABLE deal_pipeline_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Banks can view their own pipeline runs" ON deal_pipeline_runs;
DROP POLICY IF EXISTS "Service role full access" ON deal_pipeline_runs;
DROP POLICY IF EXISTS "deny_all_deal_pipeline_runs" ON deal_pipeline_runs;
CREATE POLICY "deny_all_deal_pipeline_runs" ON deal_pipeline_runs FOR ALL USING (false);

CREATE OR REPLACE FUNCTION get_latest_pipeline_run(p_deal_id uuid)
RETURNS deal_pipeline_runs
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_run deal_pipeline_runs;
BEGIN
  SELECT * INTO v_run
  FROM deal_pipeline_runs
  WHERE deal_id = p_deal_id
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION append_stage_log(
  p_run_id uuid,
  p_stage pipeline_stage,
  p_status text,
  p_message text,
  p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE deal_pipeline_runs
  SET
    stage_logs = stage_logs || jsonb_build_object(
      'stage', p_stage,
      'status', p_status,
      'message', p_message,
      'data', p_data,
      'timestamp', now()
    ),
    updated_at = now()
  WHERE id = p_run_id;
END;
$$;

COMMENT ON TABLE deal_pipeline_runs IS 'Tracks execution of E-Tran Ready Autopilot pipeline, enables resumability and observability';
COMMENT ON COLUMN deal_pipeline_runs.mode IS 'full = all stages, fast = skip non-critical stages for speed';
COMMENT ON COLUMN deal_pipeline_runs.force_rerun IS 'If true, rerun all stages even if recent successful run exists';
COMMENT ON COLUMN deal_pipeline_runs.stage_logs IS 'Append-only array of stage execution events with timestamps';
COMMENT ON COLUMN deal_pipeline_runs.triggered_by IS 'What triggered this run: banker button, borrower upload, scheduled job, or API call';
