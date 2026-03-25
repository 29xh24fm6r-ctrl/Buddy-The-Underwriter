-- Phase 53A.1 — Builder Credit Corrections
-- Extends deal_collateral_items with valuation methodology and LTV fields.
-- Extends ownership_entities with ownership_pct and title for builder prefill.

-- 1. Collateral valuation methodology + LTV fields
ALTER TABLE public.deal_collateral_items
  ADD COLUMN IF NOT EXISTS valuation_method text,
  ADD COLUMN IF NOT EXISTS valuation_source_note text,
  ADD COLUMN IF NOT EXISTS advance_rate numeric,
  ADD COLUMN IF NOT EXISTS net_lendable_value numeric;

-- 2. Ownership entity fields needed by builder prefill
-- These were referenced by builderPrefill.ts but missing from schema.
ALTER TABLE public.ownership_entities
  ADD COLUMN IF NOT EXISTS ownership_pct numeric(7,4),
  ADD COLUMN IF NOT EXISTS title text;
