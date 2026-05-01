-- Slice 3 — FDD Extraction provenance for brand-level economics.
--
-- A single brand can have multiple fdd_filings rows (one per state-year);
-- the orchestrator extracts items 5/6/7/20 from each, but only ONE filing's
-- numbers should populate the brand-level economics columns
-- (franchise_fee_min/max, royalty_pct, ad_fund_pct, initial_investment_*,
-- net_worth_requirement, liquidity_requirement, unit_count). Rule:
-- most-recent filing_year wins.
--
-- These two columns track which filing last set those numbers so the
-- orchestrator can implement: only UPDATE when filing_year >=
-- COALESCE(economics_source_year, 0). After update, both fields are set.

ALTER TABLE public.franchise_brands
  ADD COLUMN IF NOT EXISTS economics_source_filing_id uuid
    REFERENCES public.fdd_filings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS economics_source_year integer;

COMMENT ON COLUMN public.franchise_brands.economics_source_filing_id IS
  'fdd_filings.id whose extraction populated the brand-level economics columns. '
  'Updated by franchise-fdd-extractor when a more-recent filing supersedes prior data.';

COMMENT ON COLUMN public.franchise_brands.economics_source_year IS
  'filing_year of the fdd_filings row referenced by economics_source_filing_id. '
  'The orchestrator only overwrites brand economics when extracting a filing '
  'whose filing_year >= this value.';
