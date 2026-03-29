-- Phase 58B: Add SBA guarantee columns to buddy_sba_packages
-- Additive only — never drop existing columns
ALTER TABLE buddy_sba_packages
  ADD COLUMN IF NOT EXISTS sba_guarantee_pct     numeric(5,4),
  ADD COLUMN IF NOT EXISTS sba_guarantee_amount  numeric(14,2),
  ADD COLUMN IF NOT EXISTS sba_bank_exposure     numeric(14,2),
  ADD COLUMN IF NOT EXISTS sba_bank_exposure_pct numeric(5,4);
