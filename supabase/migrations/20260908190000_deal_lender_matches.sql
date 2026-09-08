-- deal_lender_matches: persisted read model of the lender matching engine.
--
-- /api/deals/[dealId]/lenders/match computed matches live and returned them,
-- but nothing persisted them, while the insights read model
-- (/api/deals/[dealId]/insights, deriveDealInsights) counts rows in this
-- table for "N lenders matched this structure" and treated its absence as a
-- degraded source. The match route now replaces a deal's rows on every run.

CREATE TABLE IF NOT EXISTS public.deal_lender_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id UUID NOT NULL,
  lender_program_id UUID NULL REFERENCES public.lender_programs(id) ON DELETE SET NULL,
  snapshot_id UUID NULL REFERENCES public.financial_snapshots(id) ON DELETE SET NULL,

  lender_name TEXT NOT NULL,
  program_name TEXT NULL,
  fit_score NUMERIC NOT NULL,
  reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS deal_lender_matches_deal_idx
  ON public.deal_lender_matches(deal_id);

CREATE INDEX IF NOT EXISTS deal_lender_matches_bank_idx
  ON public.deal_lender_matches(bank_id);

CREATE UNIQUE INDEX IF NOT EXISTS deal_lender_matches_deal_program_uidx
  ON public.deal_lender_matches(deal_id, lender_program_id)
  WHERE lender_program_id IS NOT NULL;

-- Same posture as lender_programs / deal_underwriting_scores: RLS on, no
-- anon/authenticated policies — only the service role reads and writes it.
ALTER TABLE public.deal_lender_matches ENABLE ROW LEVEL SECURITY;
