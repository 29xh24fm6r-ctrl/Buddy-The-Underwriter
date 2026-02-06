-- 20260206200000_pricing_decision_system.sql
-- Institutional pricing decision system: scenarios, decisions, and terms.
-- Pricing sits downstream of: Spreads → Financial Snapshot → Pricing → Credit Memo → Pipeline

-- ── pricing_scenarios ─────────────────────────────────────────────────────────
-- Multiple scenarios per deal, each bound to a specific financial snapshot.
CREATE TABLE IF NOT EXISTS public.pricing_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id UUID NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,
  financial_snapshot_id UUID NOT NULL REFERENCES public.financial_snapshots(id) ON DELETE CASCADE,
  loan_request_id UUID NOT NULL REFERENCES public.deal_loan_requests(id) ON DELETE CASCADE,

  scenario_key TEXT NOT NULL,  -- BASE, CONSERVATIVE, STRETCH
  product_type TEXT NOT NULL,  -- SBA_7A, SBA_504, CONVENTIONAL, CRE_TERM, etc.

  structure JSONB NOT NULL,    -- rates, fees, amort, term, guaranty
  metrics JSONB NOT NULL,      -- DSCR, LTV, DY, IRR, global CF impact
  policy_overlays JSONB,       -- applied bank/SBA overlays + research refs

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (deal_id, scenario_key)
);

CREATE INDEX IF NOT EXISTS idx_pricing_scenarios_deal
  ON public.pricing_scenarios (deal_id, bank_id);

CREATE INDEX IF NOT EXISTS idx_pricing_scenarios_snapshot
  ON public.pricing_scenarios (financial_snapshot_id);

-- ── pricing_decisions ─────────────────────────────────────────────────────────
-- ONE decision per deal. This is the pipeline gate.
CREATE TABLE IF NOT EXISTS public.pricing_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id UUID NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,
  pricing_scenario_id UUID NOT NULL REFERENCES public.pricing_scenarios(id) ON DELETE CASCADE,
  financial_snapshot_id UUID NOT NULL REFERENCES public.financial_snapshots(id) ON DELETE CASCADE,

  decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED', 'RESTRUCTURE')),
  rationale TEXT NOT NULL,
  risks JSONB,
  mitigants JSONB,

  decided_by TEXT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (deal_id)
);

CREATE INDEX IF NOT EXISTS idx_pricing_decisions_deal
  ON public.pricing_decisions (deal_id, bank_id);

CREATE INDEX IF NOT EXISTS idx_pricing_decisions_scenario
  ON public.pricing_decisions (pricing_scenario_id);

-- ── pricing_terms ─────────────────────────────────────────────────────────────
-- Approved terms extracted from the decision's selected scenario.
CREATE TABLE IF NOT EXISTS public.pricing_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_decision_id UUID NOT NULL REFERENCES public.pricing_decisions(id) ON DELETE CASCADE,

  interest_rate NUMERIC,
  spread NUMERIC,
  index_code TEXT,
  base_rate NUMERIC,
  amort_years INT,
  term_years INT,
  loan_amount NUMERIC,
  fees JSONB,
  prepayment JSONB,
  guaranty TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pricing_terms_decision
  ON public.pricing_terms (pricing_decision_id);
