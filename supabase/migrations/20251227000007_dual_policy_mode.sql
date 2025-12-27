-- =====================================================================
-- DUAL POLICY MODE (SBA + CONVENTIONAL)
-- Same pipeline, different policy packs
-- =====================================================================

-- Loan product types
CREATE TYPE loan_product_type AS ENUM (
  'SBA_7A',
  'SBA_EXPRESS',
  'SBA_504',
  'CONVENTIONAL_CASHFLOW',
  'CONVENTIONAL_CRE',
  'CONVENTIONAL_ABL'
);

-- Policy pack reference
CREATE TYPE policy_pack_type AS ENUM (
  'SBA_SOP_50_10',
  'SBA_SOP_50_10_EXPRESS',
  'SBA_SOP_50_10_504',
  'BANK_CONVENTIONAL_CF',
  'BANK_CONVENTIONAL_CRE',
  'BANK_CONVENTIONAL_ABL'
);

-- Add columns to deals table
ALTER TABLE deals 
  ADD COLUMN IF NOT EXISTS loan_product loan_product_type DEFAULT 'SBA_7A',
  ADD COLUMN IF NOT EXISTS primary_policy_pack policy_pack_type DEFAULT 'SBA_SOP_50_10',
  ADD COLUMN IF NOT EXISTS secondary_policy_pack policy_pack_type; -- For dual evaluation

-- Add columns to deal_pipeline_runs table
ALTER TABLE deal_pipeline_runs
  ADD COLUMN IF NOT EXISTS policy_pack policy_pack_type NOT NULL DEFAULT 'SBA_SOP_50_10',
  ADD COLUMN IF NOT EXISTS loan_product loan_product_type NOT NULL DEFAULT 'SBA_7A';

CREATE INDEX IF NOT EXISTS idx_deals_loan_product ON deals(loan_product);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_policy_pack ON deal_pipeline_runs(policy_pack);


-- ---------------------------------------------------------------------
-- policy_pack_configurations
-- Policy pack metadata and requirements
-- ---------------------------------------------------------------------
CREATE TABLE policy_pack_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_pack policy_pack_type NOT NULL UNIQUE,
  loan_product loan_product_type NOT NULL,
  
  -- Configuration
  display_name TEXT NOT NULL,
  readiness_label TEXT NOT NULL, -- 'E-Tran Ready', 'Credit-Ready', etc.
  required_outputs TEXT[] NOT NULL, -- ['1919', '1920', 'CreditMemo']
  
  -- Policy rules URL
  policy_rules_url TEXT,
  policy_version TEXT,
  
  -- Documentation requirements
  required_doc_packs TEXT[], -- Reference to pack_templates
  
  -- Underwriting thresholds
  min_dscr DECIMAL(5,4),
  max_leverage DECIMAL(5,4),
  max_ltv DECIMAL(5,4),
  min_credit_score INTEGER,
  
  -- Agent configuration overrides
  agent_config JSONB DEFAULT '{}'::jsonb,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed data
INSERT INTO policy_pack_configurations (policy_pack, loan_product, display_name, readiness_label, required_outputs) VALUES
  ('SBA_SOP_50_10', 'SBA_7A', 'SBA 7(a) Standard', 'E-Tran Ready', ARRAY['1919', '1920', 'Eligibility', 'CreditMemo', 'EvidenceIndex']),
  ('SBA_SOP_50_10_EXPRESS', 'SBA_EXPRESS', 'SBA Express', 'E-Tran Ready (Express)', ARRAY['1919', '1920', 'CreditMemo']),
  ('BANK_CONVENTIONAL_CF', 'CONVENTIONAL_CASHFLOW', 'Conventional Cash Flow', 'Credit-Ready', ARRAY['CreditMemo', 'CashFlow', 'Conditions']),
  ('BANK_CONVENTIONAL_CRE', 'CONVENTIONAL_CRE', 'Conventional CRE', 'Credit-Ready (CRE)', ARRAY['CreditMemo', 'GlobalCF', 'Collateral'])
ON CONFLICT (policy_pack) DO NOTHING;

-- RLS: Read-only for authenticated users
ALTER TABLE policy_pack_configurations ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_read_policy_packs ON policy_pack_configurations FOR SELECT USING (true);


-- ---------------------------------------------------------------------
-- policy_evaluation_results
-- Store dual-mode evaluation outcomes
-- ---------------------------------------------------------------------
CREATE TABLE policy_evaluation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id UUID NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  truth_snapshot_id UUID REFERENCES deal_truth_snapshots(id) ON DELETE SET NULL,
  
  -- Evaluation details
  policy_pack policy_pack_type NOT NULL,
  evaluation_status TEXT NOT NULL, -- 'ready', 'needs_human', 'blocked'
  readiness_score DECIMAL(5,2),
  
  -- Outcomes
  passes_eligibility BOOLEAN,
  passes_credit BOOLEAN,
  passes_cashflow BOOLEAN,
  passes_collateral BOOLEAN,
  
  -- Blockers
  blockers JSONB DEFAULT '[]'::jsonb, -- Array of {rule, reason, citation}
  
  -- Generated outputs
  outputs_available TEXT[], -- Which outputs were successfully generated
  
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_policy_eval_deal ON policy_evaluation_results(deal_id);
CREATE INDEX idx_policy_eval_policy_pack ON policy_evaluation_results(policy_pack);
CREATE INDEX idx_policy_eval_status ON policy_evaluation_results(evaluation_status);

-- RLS: Deny-all
ALTER TABLE policy_evaluation_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_policy_evaluation_results ON policy_evaluation_results FOR ALL USING (false);


-- ---------------------------------------------------------------------
-- Helper: Get evaluation for deal + policy pack
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_policy_evaluation(p_deal_id UUID, p_policy_pack policy_pack_type)
RETURNS TABLE (
  evaluation_status TEXT,
  readiness_score DECIMAL(5,2),
  passes_eligibility BOOLEAN,
  passes_credit BOOLEAN,
  passes_cashflow BOOLEAN,
  passes_collateral BOOLEAN,
  blockers JSONB,
  evaluated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.evaluation_status,
    e.readiness_score,
    e.passes_eligibility,
    e.passes_credit,
    e.passes_cashflow,
    e.passes_collateral,
    e.blockers,
    e.evaluated_at
  FROM policy_evaluation_results e
  WHERE e.deal_id = p_deal_id
    AND e.policy_pack = p_policy_pack
  ORDER BY e.evaluated_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


COMMENT ON TABLE policy_pack_configurations IS 'Policy pack metadata for SBA + Conventional products';
COMMENT ON TABLE policy_evaluation_results IS 'Dual-mode policy evaluation outcomes';
