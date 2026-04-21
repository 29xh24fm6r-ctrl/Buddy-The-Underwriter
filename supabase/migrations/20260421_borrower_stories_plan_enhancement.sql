-- Phase: God Tier Business Plan — Step 1
-- Captures the borrower's voice and vision for business plan narrative generation,
-- and adds plan_thesis + roadmap columns to buddy_sba_packages.

CREATE TABLE IF NOT EXISTS buddy_borrower_stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,

  origin_story TEXT,
  competitive_insight TEXT,
  ideal_customer TEXT,
  growth_strategy TEXT,
  biggest_risk TEXT,
  personal_vision TEXT,

  voice_formality TEXT CHECK (voice_formality IN ('casual', 'professional', 'technical')),
  voice_metaphors JSONB DEFAULT '[]'::jsonb,
  voice_values JSONB DEFAULT '[]'::jsonb,

  captured_via TEXT CHECK (captured_via IN ('voice', 'chat', 'form')) DEFAULT 'chat',
  captured_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(deal_id)
);

CREATE INDEX IF NOT EXISTS buddy_borrower_stories_deal_id_idx
  ON buddy_borrower_stories(deal_id);

ALTER TABLE buddy_borrower_stories ENABLE ROW LEVEL SECURITY;

ALTER TABLE buddy_sba_packages
  ADD COLUMN IF NOT EXISTS plan_thesis TEXT,
  ADD COLUMN IF NOT EXISTS milestone_timeline JSONB,
  ADD COLUMN IF NOT EXISTS kpi_dashboard JSONB,
  ADD COLUMN IF NOT EXISTS risk_contingency_matrix JSONB;
