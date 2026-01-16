-- 20260116140000_deal_rent_roll_rows.sql
-- Normalized rent roll rows for canonical RENT_ROLL spread.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

BEGIN;

CREATE TABLE IF NOT EXISTS public.deal_rent_roll_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id UUID NOT NULL,
  as_of_date DATE NOT NULL,

  unit_id TEXT NOT NULL,
  unit_type TEXT NULL,
  sqft NUMERIC NULL,

  tenant_name TEXT NULL,
  lease_start DATE NULL,
  lease_end DATE NULL,

  monthly_rent NUMERIC NULL,
  annual_rent NUMERIC NULL,
  market_rent_monthly NUMERIC NULL,

  occupancy_status TEXT NOT NULL CHECK (occupancy_status IN ('OCCUPIED','VACANT')),
  concessions_monthly NUMERIC NULL,

  notes TEXT NULL,
  source_document_id UUID REFERENCES public.deal_documents(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS deal_rent_roll_rows_deal_idx
  ON public.deal_rent_roll_rows (deal_id, bank_id, as_of_date);

CREATE INDEX IF NOT EXISTS deal_rent_roll_rows_unit_idx
  ON public.deal_rent_roll_rows (deal_id, bank_id, unit_id);

COMMIT;
