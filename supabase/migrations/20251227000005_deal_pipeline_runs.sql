-- SBA God Mode: Deal Pipeline Runs (Autopilot Orchestration)
-- Migration: 20251227000005_deal_pipeline_runs.sql
--
-- Tracks execution of the "E-Tran Ready Autopilot" pipeline.
-- Enables resumability, observability, and idempotent reruns.

-- Pipeline stages enum (S1-S9)
DO $$ BEGIN
  CREATE TYPE pipeline_stage AS ENUM (
    'S1_INTAKE',           -- Normalize docs + structured data
    'S2_AGENTS',           -- Run agent swarm
    'S3_CLAIMS',           -- Ingest claims + build conflict sets
    'S4_OVERLAYS',         -- Apply bank overlays
    'S5_ARBITRATION',      -- Reconcile conflicts
    'S6_TRUTH',            -- Materialize truth snapshot
    'S7_CONDITIONS',       -- Generate conditions + borrower tasks
    'S8_NARRATIVE',        -- Generate memo + evidence mapping
    'S9_PACKAGE'           -- Assemble submission bundle
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Pipeline run status enum
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

-- Main pipeline runs table
CREATE TABLE IF NOT EXISTS deal_pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
  
  status pipeline_status NOT NULL DEFAULT 'queued',
  current_stage pipeline_stage DEFAULT 'S1_INTAKE',
  progress numeric(5,2) NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  
  -- Mode: "full" (all stages) or "fast" (skip non-critical)
  mode text NOT NULL DEFAULT 'full' CHECK (mode IN ('full', 'fast')),
  force_rerun boolean NOT NULL DEFAULT false,
  
  -- Stage execution log (append-only array)
  stage_logs jsonb NOT NULL DEFAULT '[]'::jsonb,
  
  -- Error details if failed
  error_json jsonb,
  error_stage pipeline_stage,
  
  -- Outputs from pipeline
  truth_snapshot_id uuid REFERENCES deal_truth_snapshots(id),
  package_bundle_id uuid,  -- Foreign key to package_bundles table (to be created)
  
  -- Timing
  started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  
  -- Audit
  triggered_by text,  -- 'banker', 'borrower_upload', 'scheduled', 'api'
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for fast lookups
CREATE INDEX idx_deal_pipeline_runs_deal_id ON deal_pipeline_runs(deal_id);
CREATE INDEX idx_deal_pipeline_runs_bank_id ON deal_pipeline_runs(bank_id);
CREATE INDEX idx_deal_pipeline_runs_status ON deal_pipeline_runs(status);
CREATE INDEX idx_deal_pipeline_runs_created_at ON deal_pipeline_runs(created_at DESC);

-- RLS Policies
ALTER TABLE deal_pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Banks can view their own pipeline runs"
  ON deal_pipeline_runs
  FOR SELECT
  USING (bank_id = current_setting('app.current_bank_id')::uuid);

CREATE POLICY "Service role full access"
  ON deal_pipeline_runs
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Helper function: Get latest pipeline run for a deal
CREATE OR REPLACE FUNCTION get_latest_pipeline_run(p_deal_id uuid)
RETURNS deal_pipeline_runs
LANGUAGE plpgsql
STABLE
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

-- Helper function: Append stage log
CREATE OR REPLACE FUNCTION append_stage_log(
  p_run_id uuid,
  p_stage pipeline_stage,
  p_status text,
  p_message text,
  p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
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

-- Comments
COMMENT ON TABLE deal_pipeline_runs IS 'Tracks execution of E-Tran Ready Autopilot pipeline, enables resumability and observability';
COMMENT ON COLUMN deal_pipeline_runs.mode IS 'full = all stages, fast = skip non-critical stages for speed';
COMMENT ON COLUMN deal_pipeline_runs.force_rerun IS 'If true, rerun all stages even if recent successful run exists';
COMMENT ON COLUMN deal_pipeline_runs.stage_logs IS 'Append-only array of stage execution events with timestamps';
COMMENT ON COLUMN deal_pipeline_runs.triggered_by IS 'What triggered this run: banker button, borrower upload, scheduled job, or API call';
