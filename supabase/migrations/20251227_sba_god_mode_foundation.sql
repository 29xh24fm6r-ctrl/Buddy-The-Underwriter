-- SBA God-Mode Foundation
-- Part 1: Machine-readable SBA policy rules + HNSW indexing fix

-- ============================================================
-- 1. SBA Policy Rules (Machine-Readable Truth)
-- ============================================================

-- Store SBA rules as evaluable conditions, not just text
CREATE TABLE IF NOT EXISTS public.sba_policy_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Program classification
  program TEXT NOT NULL CHECK (program IN ('7A', '504', 'BOTH')),
  
  -- Rule identification
  rule_key TEXT NOT NULL, -- e.g., ELIGIBILITY.USE_OF_PROCEEDS, ELIGIBILITY.BUSINESS_AGE
  category TEXT NOT NULL, -- ELIGIBILITY, COLLATERAL, GUARANTEES, USE_OF_PROCEEDS, etc.
  
  -- Machine-evaluable condition (JSON logic)
  condition_json JSONB NOT NULL,
  
  -- Human explanation
  title TEXT NOT NULL,
  explanation TEXT NOT NULL,
  borrower_friendly_explanation TEXT, -- How to explain to borrowers
  
  -- Fix suggestions
  fix_suggestions JSONB, -- Array of { issue, fix, example }
  
  -- SBA references
  sop_reference TEXT NOT NULL, -- e.g., "SOP 50 10 7(K) Section 2.3.1"
  effective_date DATE,
  
  -- Metadata
  severity TEXT CHECK (severity IN ('HARD_STOP', 'REQUIRES_MITIGATION', 'ADVISORY')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (program, rule_key)
);

CREATE INDEX idx_sba_policy_rules_program ON public.sba_policy_rules(program);
CREATE INDEX idx_sba_policy_rules_category ON public.sba_policy_rules(category);
CREATE INDEX idx_sba_policy_rules_severity ON public.sba_policy_rules(severity);

COMMENT ON TABLE public.sba_policy_rules IS 'Machine-readable SBA policy rules for eligibility evaluation';
COMMENT ON COLUMN public.sba_policy_rules.condition_json IS 'JSON Logic format: { "all": [{ "field": "business_age_years", "gte": 2 }] }';
COMMENT ON COLUMN public.sba_policy_rules.fix_suggestions IS 'Array of suggested fixes: [{ "issue": "...", "fix": "...", "example": "..." }]';

-- ============================================================
-- 2. SBA Rule Evaluation Results (Deal-specific)
-- ============================================================

-- Track which rules pass/fail for each deal
CREATE TABLE IF NOT EXISTS public.deal_sba_rule_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(deal_id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES public.sba_policy_rules(id) ON DELETE CASCADE,
  
  -- Evaluation result
  evaluated_at TIMESTAMPTZ DEFAULT NOW(),
  passes BOOLEAN NOT NULL,
  
  -- Context
  field_values JSONB, -- Actual values used in evaluation
  failure_reason TEXT,
  suggested_fixes JSONB, -- Personalized fix suggestions
  
  -- Traceability
  evaluated_by_user_id TEXT, -- Clerk user ID
  auto_evaluated BOOLEAN DEFAULT TRUE,
  
  UNIQUE (deal_id, rule_id, evaluated_at)
);

CREATE INDEX idx_deal_sba_evaluations_deal ON public.deal_sba_rule_evaluations(deal_id);
CREATE INDEX idx_deal_sba_evaluations_passes ON public.deal_sba_rule_evaluations(deal_id, passes);

COMMENT ON TABLE public.deal_sba_rule_evaluations IS 'Results of SBA rule evaluations for specific deals';

-- ============================================================
-- 3. Fix HNSW Indexing (No Dimension Limit)
-- ============================================================

-- Drop existing ivfflat index if exists (has 2000 dim limit)
DROP INDEX IF EXISTS public.bank_policy_chunks_embedding_idx;

-- Create HNSW index (supports any dimension, faster than ivfflat)
CREATE INDEX IF NOT EXISTS bank_policy_chunks_embedding_hnsw
ON public.bank_policy_chunks
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

COMMENT ON INDEX public.bank_policy_chunks_embedding_hnsw IS 'HNSW index for semantic search (no dimension limit, faster than ivfflat)';

-- Also ensure deal_doc_chunks uses HNSW if not already
DO $$
BEGIN
  -- Check if deal_doc_chunks has HNSW index
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'deal_doc_chunks' 
    AND indexname LIKE '%hnsw%'
  ) THEN
    -- Drop old index
    DROP INDEX IF EXISTS public.deal_doc_chunks_embedding_idx;
    
    -- Create HNSW index
    CREATE INDEX deal_doc_chunks_embedding_hnsw
    ON public.deal_doc_chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
  END IF;
END $$;

-- ============================================================
-- 4. Unified Retrieval Sources
-- ============================================================

-- Enum for source types (used in unified retrieval)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'retrieval_source_type') THEN
    CREATE TYPE public.retrieval_source_type AS ENUM (
      'DEAL_DOC',
      'BANK_POLICY',
      'SBA_POLICY'
    );
  END IF;
END $$;

-- ============================================================
-- 5. Committee Personas Configuration
-- ============================================================

CREATE TABLE IF NOT EXISTS public.committee_personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Persona identity
  persona_key TEXT NOT NULL UNIQUE, -- credit, sba_compliance, risk, relationship_manager
  display_name TEXT NOT NULL,
  
  -- Evaluation rubric
  focus_areas TEXT[] NOT NULL, -- e.g., ["cash_flow", "collateral", "character"]
  risk_tolerance TEXT CHECK (risk_tolerance IN ('CONSERVATIVE', 'MODERATE', 'AGGRESSIVE')),
  
  -- Prompting
  system_prompt TEXT NOT NULL,
  evaluation_template TEXT NOT NULL,
  
  -- Output format
  output_schema JSONB NOT NULL, -- Expected response structure
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_committee_personas_key ON public.committee_personas(persona_key);

COMMENT ON TABLE public.committee_personas IS 'Credit committee persona configurations for multi-angle deal evaluation';

-- Insert default personas
INSERT INTO public.committee_personas (persona_key, display_name, focus_areas, risk_tolerance, system_prompt, evaluation_template, output_schema)
VALUES
  (
    'credit',
    'Credit Officer',
    ARRAY['cash_flow', 'debt_service_coverage', 'working_capital', 'financial_trends'],
    'MODERATE',
    'You are an experienced SBA credit officer. Your job is to evaluate the borrower''s ability to repay the loan based on cash flow, financial statements, and projections. You are pragmatic but require solid justification for any concerns.',
    'Evaluate this deal from a credit perspective. Focus on: 1) Debt service coverage, 2) Cash flow trends, 3) Working capital adequacy, 4) Financial projections credibility. Provide your stance (approve/approve_with_conditions/decline) with specific concerns and required fixes.',
    '{"stance": "string", "concerns": ["string"], "required_fixes": ["string"], "citations": [{"i": "number", "reason": "string"}]}'::jsonb
  ),
  (
    'sba_compliance',
    'SBA Compliance Officer',
    ARRAY['eligibility', 'use_of_proceeds', 'affiliation', 'size_standards', 'sba_requirements'],
    'CONSERVATIVE',
    'You are an SBA compliance officer. Your sole focus is ensuring the deal meets all SBA 7(a) and 504 program requirements per the SOP. You are strict and detail-oriented. Any deviation from SBA rules must be flagged immediately.',
    'Evaluate this deal for SBA compliance. Check: 1) Eligibility (business type, use of proceeds), 2) Size standards, 3) Affiliation rules, 4) Required guarantees, 5) Credit elsewhere test. Be specific about any SOP violations.',
    '{"stance": "string", "concerns": ["string"], "required_fixes": ["string"], "citations": [{"i": "number", "reason": "string"}]}'::jsonb
  ),
  (
    'risk',
    'Risk Officer',
    ARRAY['collateral', 'guarantees', 'industry_risk', 'concentration', 'market_conditions'],
    'CONSERVATIVE',
    'You are a bank risk officer. You focus on downside protection: collateral coverage, personal guarantees, industry risks, and portfolio concentration. You ask "what if things go wrong?"',
    'Evaluate this deal from a risk perspective. Focus on: 1) Collateral coverage, 2) Personal guarantee strength, 3) Industry risks, 4) Geographic/customer concentration, 5) Exit strategies if deal fails. Identify all risk factors and required mitigants.',
    '{"stance": "string", "concerns": ["string"], "required_fixes": ["string"], "citations": [{"i": "number", "reason": "string"}]}'::jsonb
  ),
  (
    'relationship_manager',
    'Relationship Manager',
    ARRAY['customer_relationship', 'cross_sell_opportunity', 'reputation', 'strategic_fit'],
    'AGGRESSIVE',
    'You are a relationship manager. You focus on the customer relationship, their potential for future business, and strategic fit with the bank. You advocate for good customers and look for ways to make deals work.',
    'Evaluate this deal from a relationship perspective. Consider: 1) Customer quality and longevity, 2) Cross-sell opportunities, 3) Reputational impact, 4) Strategic alignment with bank goals. Advocate for the customer where appropriate while being realistic about concerns.',
    '{"stance": "string", "concerns": ["string"], "required_fixes": ["string"], "citations": [{"i": "number", "reason": "string"}]}'::jsonb
  )
ON CONFLICT (persona_key) DO NOTHING;

-- ============================================================
-- 6. SBA Difficulty Index (Progress Scoring)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.deal_sba_difficulty_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(deal_id) ON DELETE CASCADE,
  
  -- Overall score
  difficulty_score NUMERIC(5,2) NOT NULL CHECK (difficulty_score >= 0 AND difficulty_score <= 100),
  readiness_percentage INT GENERATED ALWAYS AS (CASE WHEN difficulty_score >= 80 THEN 100 ELSE (difficulty_score * 1.25)::int END) STORED,
  
  -- Component scores
  eligibility_score NUMERIC(5,2),
  financial_score NUMERIC(5,2),
  collateral_score NUMERIC(5,2),
  documentation_score NUMERIC(5,2),
  
  -- Blockers
  hard_stops INT DEFAULT 0,
  mitigable_issues INT DEFAULT 0,
  advisory_items INT DEFAULT 0,
  
  -- Recommendations
  top_fixes JSONB, -- Array of { priority, fix, impact }
  estimated_time_to_ready TEXT, -- "2 days", "1 week", etc.
  
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (deal_id, calculated_at)
);

CREATE INDEX idx_deal_sba_difficulty_deal ON public.deal_sba_difficulty_scores(deal_id);
CREATE INDEX idx_deal_sba_difficulty_score ON public.deal_sba_difficulty_scores(difficulty_score DESC);

COMMENT ON TABLE public.deal_sba_difficulty_scores IS 'SBA readiness scoring for gamified borrower experience';
COMMENT ON COLUMN public.deal_sba_difficulty_scores.readiness_percentage IS 'User-facing percentage (e.g., "You are 87% SBA-ready")';

-- ============================================================
-- Grant Permissions
-- ============================================================

-- Grant service role access (all tables)
GRANT ALL ON public.sba_policy_rules TO service_role;
GRANT ALL ON public.deal_sba_rule_evaluations TO service_role;
GRANT ALL ON public.committee_personas TO service_role;
GRANT ALL ON public.deal_sba_difficulty_scores TO service_role;

-- Enable RLS (deny-all by default, access via service role)
ALTER TABLE public.sba_policy_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_sba_rule_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.committee_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_sba_difficulty_scores ENABLE ROW LEVEL SECURITY;
