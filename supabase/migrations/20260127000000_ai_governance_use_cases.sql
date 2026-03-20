-- ============================================================================
-- AI Governance Use Case Registry
-- ============================================================================
-- Each row represents one AI-driven capability (mission type) that Buddy uses.
-- Banks must review and approve each use case before it can auto-run.
--
-- Governance levels:
--   automation_level: 'auto' | 'human_in_loop' | 'restricted'
--   approval_status:  'approved' | 'pending_review' | 'restricted'
--
-- Runtime enforcement rule:
--   A mission may ONLY auto-run if:
--     approval_status = 'approved' AND automation_level = 'auto'
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.buddy_ai_use_cases (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_type    text        NOT NULL UNIQUE,
  name            text        NOT NULL,
  description     text        NOT NULL DEFAULT '',
  risk_tier       text        NOT NULL DEFAULT 'medium'
    CHECK (risk_tier IN ('low', 'medium', 'high')),
  automation_level text       NOT NULL DEFAULT 'human_in_loop'
    CHECK (automation_level IN ('auto', 'human_in_loop', 'restricted')),
  approval_status  text       NOT NULL DEFAULT 'pending_review'
    CHECK (approval_status IN ('approved', 'pending_review', 'restricted')),
  approved_by     text        NULL,
  approved_at     timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Index for runtime lookup
CREATE INDEX IF NOT EXISTS idx_ai_use_cases_mission_type ON public.buddy_ai_use_cases (mission_type);

-- ============================================================================
-- Seed all 8 mission types
-- ============================================================================

INSERT INTO public.buddy_ai_use_cases (mission_type, name, description, risk_tier, automation_level, approval_status)
VALUES
  (
    'industry_landscape',
    'Industry & Competitive Landscape',
    'Analyzes industry size, growth trends, employment data, and competitive dynamics using government and industry sources (BLS, Census, IBISWorld).',
    'low',
    'auto',
    'approved'
  ),
  (
    'competitive_analysis',
    'Competitive Analysis',
    'Identifies major competitors, market shares, and competitive positioning within the borrower''s NAICS sector.',
    'low',
    'auto',
    'approved'
  ),
  (
    'market_demand',
    'Market Demand & Demographics',
    'Assesses market demand drivers and demographic factors for the borrower''s geographic area and industry.',
    'low',
    'auto',
    'approved'
  ),
  (
    'demographics',
    'Demographics',
    'Detailed demographic analysis including population trends, income levels, and consumer spending patterns for consumer-facing businesses.',
    'low',
    'auto',
    'approved'
  ),
  (
    'regulatory_environment',
    'Regulatory Environment',
    'Analyzes regulatory requirements, compliance burden, licensing needs, and enforcement trends for the borrower''s industry.',
    'medium',
    'auto',
    'approved'
  ),
  (
    'management_backgrounds',
    'Management Background Checks',
    'Researches principal owners and management team backgrounds, qualifications, and public records.',
    'high',
    'human_in_loop',
    'pending_review'
  ),
  (
    'lender_fit_analysis',
    'Lender Fit Analysis',
    'Evaluates how well the loan request fits the bank''s lending policies, portfolio concentration, and risk appetite.',
    'medium',
    'auto',
    'approved'
  ),
  (
    'scenario_stress',
    'Scenario & Stress Testing',
    'Runs stress scenarios (rate shock, revenue decline, cost increase) against the borrower''s financial projections.',
    'medium',
    'auto',
    'approved'
  )
ON CONFLICT (mission_type) DO NOTHING;
