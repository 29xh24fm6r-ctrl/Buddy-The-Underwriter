-- Phase 58A: Add SBA-specific columns to buddy_industry_benchmarks
ALTER TABLE buddy_industry_benchmarks
  ADD COLUMN IF NOT EXISTS sba_default_rate_5yr numeric(6,4),
  ADD COLUMN IF NOT EXISTS sba_default_rate_10yr numeric(6,4),
  ADD COLUMN IF NOT EXISTS sba_avg_loan_size numeric(14,2),
  ADD COLUMN IF NOT EXISTS sba_approval_rate numeric(6,4),
  ADD COLUMN IF NOT EXISTS sba_charge_off_rate numeric(6,4),
  ADD COLUMN IF NOT EXISTS sba_data_source text,
  ADD COLUMN IF NOT EXISTS sba_data_vintage date;
