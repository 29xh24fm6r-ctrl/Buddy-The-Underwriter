-- Phase 58A: Add SBA-specific columns to buddy_industry_benchmarks
-- Additive only — never drop existing columns
ALTER TABLE buddy_industry_benchmarks
  ADD COLUMN IF NOT EXISTS sba_default_rate_pct    numeric(5,4),
  ADD COLUMN IF NOT EXISTS sba_charge_off_rate_pct numeric(5,4),
  ADD COLUMN IF NOT EXISTS sba_default_risk_tier   text,
  ADD COLUMN IF NOT EXISTS sba_sample_size         integer,
  ADD COLUMN IF NOT EXISTS sba_data_period         text,
  ADD COLUMN IF NOT EXISTS sba_notes               text;
