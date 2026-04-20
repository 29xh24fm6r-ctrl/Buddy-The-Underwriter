-- Phase BPG — Business Plan God Tier
-- Migration 1: extend buddy_sba_packages with business-plan narrative columns,
-- Sources & Uses, versioning, franchise narrative, warnings, global cash flow,
-- balance sheet projections, and cross-fill audit.
-- All columns are nullable or defaulted — non-breaking for existing rows.

ALTER TABLE buddy_sba_packages
  ADD COLUMN IF NOT EXISTS executive_summary text,
  ADD COLUMN IF NOT EXISTS industry_analysis text,
  ADD COLUMN IF NOT EXISTS marketing_strategy text,
  ADD COLUMN IF NOT EXISTS operations_plan text,
  ADD COLUMN IF NOT EXISTS swot_strengths text,
  ADD COLUMN IF NOT EXISTS swot_weaknesses text,
  ADD COLUMN IF NOT EXISTS swot_opportunities text,
  ADD COLUMN IF NOT EXISTS swot_threats text,
  ADD COLUMN IF NOT EXISTS sources_and_uses jsonb DEFAULT '{}' ::jsonb,
  ADD COLUMN IF NOT EXISTS version_number integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS parent_package_id uuid REFERENCES buddy_sba_packages(id),
  ADD COLUMN IF NOT EXISTS franchise_section text,
  ADD COLUMN IF NOT EXISTS package_warnings jsonb DEFAULT '[]' ::jsonb,
  ADD COLUMN IF NOT EXISTS benchmark_warnings jsonb DEFAULT '[]' ::jsonb,
  ADD COLUMN IF NOT EXISTS global_cash_flow jsonb DEFAULT '{}' ::jsonb,
  ADD COLUMN IF NOT EXISTS global_dscr numeric,
  ADD COLUMN IF NOT EXISTS balance_sheet_projections jsonb DEFAULT '[]' ::jsonb,
  ADD COLUMN IF NOT EXISTS forms_cross_filled jsonb DEFAULT '[]' ::jsonb;
