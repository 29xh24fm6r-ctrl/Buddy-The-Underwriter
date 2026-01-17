-- ============================================================
-- DEAL UNDERWRITING SCORES + LENDER PROGRAMS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1) Deal underwriting scores (versioned per snapshot)
CREATE TABLE IF NOT EXISTS public.deal_underwriting_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id UUID NOT NULL,
  snapshot_id UUID NOT NULL REFERENCES public.financial_snapshots(id) ON DELETE CASCADE,

  score NUMERIC NOT NULL,
  grade TEXT NOT NULL,
  confidence NUMERIC NOT NULL,
  drivers_json JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS deal_underwriting_scores_deal_idx
  ON public.deal_underwriting_scores(deal_id);

CREATE INDEX IF NOT EXISTS deal_underwriting_scores_snapshot_idx
  ON public.deal_underwriting_scores(snapshot_id);

CREATE INDEX IF NOT EXISTS deal_underwriting_scores_created_at_idx
  ON public.deal_underwriting_scores(created_at DESC);

-- 2) Lender programs (bank-scoped)
CREATE TABLE IF NOT EXISTS public.lender_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id UUID NOT NULL,

  lender_name TEXT NOT NULL,
  program_name TEXT NULL,
  min_dscr NUMERIC NULL,
  max_ltv NUMERIC NULL,
  asset_types TEXT[] NULL,
  geography TEXT[] NULL,
  sba_only BOOLEAN NOT NULL DEFAULT false,
  score_threshold NUMERIC NULL,
  notes TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lender_programs_bank_idx
  ON public.lender_programs(bank_id);

CREATE INDEX IF NOT EXISTS lender_programs_lender_idx
  ON public.lender_programs(lender_name);

ALTER TABLE public.deal_underwriting_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lender_programs ENABLE ROW LEVEL SECURITY;
