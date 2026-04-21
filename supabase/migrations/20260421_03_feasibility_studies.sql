-- Phase God Tier Feasibility — buddy_feasibility_studies table.
-- Consumes BIE research + SBA projections + financial spreading as inputs.
-- Deterministic scoring with a Gemini narrative overlay. Non-breaking — no
-- FK conflicts with existing tables; projections_package_id is optional.
-- Applied via Supabase MCP; file committed for repo history.

CREATE TABLE IF NOT EXISTS buddy_feasibility_studies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL,

  -- Composite score + recommendation
  composite_score integer NOT NULL,
  recommendation text NOT NULL,
  confidence_level text NOT NULL DEFAULT 'Low',

  -- Dimension scores
  market_demand_score integer NOT NULL,
  financial_viability_score integer NOT NULL,
  operational_readiness_score integer NOT NULL,
  location_suitability_score integer NOT NULL,

  -- Full dimension detail (jsonb)
  market_demand_detail jsonb NOT NULL DEFAULT '{}',
  financial_viability_detail jsonb NOT NULL DEFAULT '{}',
  operational_readiness_detail jsonb NOT NULL DEFAULT '{}',
  location_suitability_detail jsonb NOT NULL DEFAULT '{}',

  -- Narratives
  narratives jsonb NOT NULL DEFAULT '{}',

  -- Franchise comparison (null for non-franchise)
  franchise_comparison jsonb,
  is_franchise boolean NOT NULL DEFAULT false,

  -- Flags
  flags jsonb NOT NULL DEFAULT '[]',
  data_completeness numeric NOT NULL DEFAULT 0,

  -- Outputs
  pdf_url text,
  projections_package_id uuid REFERENCES buddy_sba_packages(id),

  -- Metadata
  status text NOT NULL DEFAULT 'pending',
  version_number integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(deal_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_feasibility_deal ON buddy_feasibility_studies(deal_id);
CREATE INDEX IF NOT EXISTS idx_feasibility_score ON buddy_feasibility_studies(composite_score);
CREATE INDEX IF NOT EXISTS idx_feasibility_recommendation ON buddy_feasibility_studies(recommendation);

COMMENT ON TABLE buddy_feasibility_studies IS 'God tier feasibility study results. Consumes BIE research + SBA projections + financial spreading. Deterministic scoring with Gemini narrative overlay.';
