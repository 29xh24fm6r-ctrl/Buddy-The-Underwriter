-- =====================================================================
-- PRE-APPROVAL SIMULATOR SCHEMA
-- Borrower sees what they qualify for BEFORE applying
-- =====================================================================

-- Simulation run status
CREATE TYPE sim_status AS ENUM ('running', 'succeeded', 'failed');

-- ---------------------------------------------------------------------
-- preapproval_sim_runs
-- Tracks simulation execution (observable, resumable)
-- ---------------------------------------------------------------------
CREATE TABLE preapproval_sim_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id UUID NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  
  -- Execution state
  status sim_status NOT NULL DEFAULT 'running',
  progress DECIMAL(5,2) NOT NULL DEFAULT 0,
  current_stage TEXT NOT NULL DEFAULT 'S1',
  
  -- Logs (append-only JSONB array)
  logs JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_json JSONB,
  
  -- Audit
  triggered_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX idx_preapproval_runs_deal ON preapproval_sim_runs(deal_id);
CREATE INDEX idx_preapproval_runs_status ON preapproval_sim_runs(status, created_at DESC);

-- RLS: Deny-all
ALTER TABLE preapproval_sim_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_preapproval_sim_runs ON preapproval_sim_runs FOR ALL USING (false);


-- ---------------------------------------------------------------------
-- preapproval_sim_results
-- Simulation output (one row per successful run)
-- ---------------------------------------------------------------------
CREATE TABLE preapproval_sim_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id UUID NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES preapproval_sim_runs(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  
  -- Simulated truth snapshot (NOT committed as real truth)
  truth_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Offers (amount/term/rate bands + rationale)
  offers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Punchlist (missing items / conditions)
  punchlist_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Policy outcomes
  sba_outcome_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  conventional_outcome_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Overall confidence
  confidence DECIMAL(5,4) NOT NULL DEFAULT 0.5,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_preapproval_results_deal ON preapproval_sim_results(deal_id);
CREATE INDEX idx_preapproval_results_run ON preapproval_sim_results(run_id);

-- GIN index for JSONB queries
CREATE INDEX idx_preapproval_results_offers ON preapproval_sim_results USING gin(offers_json);
CREATE INDEX idx_preapproval_results_sba ON preapproval_sim_results USING gin(sba_outcome_json);
CREATE INDEX idx_preapproval_results_conv ON preapproval_sim_results USING gin(conventional_outcome_json);

-- RLS: Deny-all
ALTER TABLE preapproval_sim_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_preapproval_sim_results ON preapproval_sim_results FOR ALL USING (false);


-- ---------------------------------------------------------------------
-- Helper: Get latest simulation for a deal
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_latest_simulation(p_deal_id UUID)
RETURNS TABLE (
  run_id UUID,
  status sim_status,
  result_id UUID,
  offers JSONB,
  sba_outcome JSONB,
  conv_outcome JSONB,
  confidence DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.id as run_id,
    r.status,
    res.id as result_id,
    res.offers_json as offers,
    res.sba_outcome_json as sba_outcome,
    res.conventional_outcome_json as conv_outcome,
    res.confidence
  FROM preapproval_sim_runs r
  LEFT JOIN preapproval_sim_results res ON res.run_id = r.id
  WHERE r.deal_id = p_deal_id
  ORDER BY r.created_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ---------------------------------------------------------------------
-- Helper: Log simulation stage
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_sim_stage(
  p_run_id UUID,
  p_stage TEXT,
  p_message TEXT
)
RETURNS VOID AS $$
BEGIN
  UPDATE preapproval_sim_runs
  SET 
    logs = logs || jsonb_build_object(
      'stage', p_stage,
      'message', p_message,
      'timestamp', now()
    )::jsonb,
    current_stage = p_stage,
    updated_at = now()
  WHERE id = p_run_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


COMMENT ON TABLE preapproval_sim_runs IS 'Pre-approval simulation execution tracking';
COMMENT ON TABLE preapproval_sim_results IS 'Pre-approval simulation results (viability, offers, punchlist)';
