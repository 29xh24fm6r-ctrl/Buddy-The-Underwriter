-- 20251220_loan_requests.sql

-- ------------------------------------------------------------
-- 1) Loan product requests (borrower-safe)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_loan_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,

  product_type text NOT NULL CHECK (product_type IN (
    'SBA_7A',
    'SBA_504',
    'CRE_TERM',
    'C_AND_I_TERM',
    'LINE_OF_CREDIT',
    'EQUIPMENT',
    'REFINANCE',
    'OTHER'
  )),

  -- borrower-safe request parameters (what they want)
  requested_amount numeric NULL,
  requested_term_months int NULL,
  requested_amort_months int NULL,
  requested_rate_type text NULL CHECK (requested_rate_type IN ('FIXED','VARIABLE') OR requested_rate_type IS NULL),
  requested_rate_index text NULL, -- e.g. "Prime", "SOFR", "WSJ Prime"
  requested_spread_bps int NULL,
  requested_interest_only_months int NULL,

  purpose text NULL,              -- free text: "purchase building", "refi debt", "working capital"
  use_of_proceeds jsonb NULL,     -- [{category, amount, notes}]
  collateral_summary text NULL,   -- borrower-provided collateral info
  guarantors_summary text NULL,   -- borrower-provided

  notes text NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_loan_requests_deal_idx
  ON public.deal_loan_requests(deal_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_deal_loan_requests_updated_at ON public.deal_loan_requests;
CREATE TRIGGER trg_deal_loan_requests_updated_at
BEFORE UPDATE ON public.deal_loan_requests
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- 2) Banker underwrite inputs derived from requests (banker-only)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_underwrite_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,

  -- separate from borrower requests: what bank is actually structuring
  proposed_product_type text NOT NULL CHECK (proposed_product_type IN (
    'SBA_7A',
    'SBA_504',
    'CRE_TERM',
    'C_AND_I_TERM',
    'LINE_OF_CREDIT',
    'EQUIPMENT',
    'REFINANCE',
    'OTHER'
  )),

  proposed_amount numeric NULL,
  proposed_term_months int NULL,
  proposed_amort_months int NULL,
  proposed_rate_type text NULL CHECK (proposed_rate_type IN ('FIXED','VARIABLE') OR proposed_rate_type IS NULL),
  proposed_rate_index text NULL,
  proposed_spread_bps int NULL,
  proposed_interest_only_months int NULL,

  -- banker-only knobs that often impact underwriting models
  guarantee_percent numeric NULL,     -- e.g. SBA guarantee %
  ltv_target numeric NULL,            -- target LTV
  dscr_target numeric NULL,           -- target DSCR
  global_dscr_target numeric NULL,
  pricing_floor_rate numeric NULL,

  covenants jsonb NULL,               -- structured covenants
  exceptions jsonb NULL,              -- proposed exceptions
  internal_notes text NULL,           -- banker-only

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_underwrite_inputs_deal_idx
  ON public.deal_underwrite_inputs(deal_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_deal_underwrite_inputs_updated_at ON public.deal_underwrite_inputs;
CREATE TRIGGER trg_deal_underwrite_inputs_updated_at
BEFORE UPDATE ON public.deal_underwrite_inputs
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- 3) RLS: keep locked (server routes only) per your canonical model
-- ------------------------------------------------------------
ALTER TABLE public.deal_loan_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_underwrite_inputs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_loan_requests_none ON public.deal_loan_requests;
CREATE POLICY deal_loan_requests_none ON public.deal_loan_requests
FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deal_underwrite_inputs_none ON public.deal_underwrite_inputs;
CREATE POLICY deal_underwrite_inputs_none ON public.deal_underwrite_inputs
FOR ALL USING (false) WITH CHECK (false);
