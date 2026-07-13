BEGIN;

CREATE TABLE IF NOT EXISTS public.borrower_credit_pulls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  ownership_entity_id uuid NOT NULL REFERENCES public.ownership_entities(id) ON DELETE CASCADE,

  -- HARD CONSTRAINT: pull_type is always 'soft'. No hard pull anywhere.
  pull_type text NOT NULL DEFAULT 'soft' CHECK (pull_type = 'soft'),

  vendor text NOT NULL CHECK (vendor IN ('plaid_check','array','measureone','transunion','equifax','experian')),
  vendor_request_id text NOT NULL,
  bureau text CHECK (bureau IN ('TU','EFX','EXP')),

  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','completed','failed','expired')),
  status_reason text,

  -- Consent (FCRA § 1681b(a)(2) — written instruction)
  consent_version text NOT NULL,
  consent_text_hash text NOT NULL,
  consent_ip text,
  consent_user_agent text,
  consent_at timestamptz NOT NULL,

  -- Idempotency
  idempotency_key text NOT NULL UNIQUE,

  -- Result references
  result_storage_path text,
  result_summary jsonb,
  fico_score integer,
  delinquencies_count integer,
  public_records_count integer,
  inquiries_24mo_count integer,

  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bcp_deal ON public.borrower_credit_pulls(deal_id);
CREATE INDEX idx_bcp_entity ON public.borrower_credit_pulls(ownership_entity_id);
CREATE INDEX idx_bcp_status ON public.borrower_credit_pulls(status) WHERE status='requested';

ALTER TABLE public.borrower_credit_pulls ENABLE ROW LEVEL SECURITY;
CREATE POLICY bcp_deny ON public.borrower_credit_pulls FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY bcp_select_bank ON public.borrower_credit_pulls FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id=borrower_credit_pulls.bank_id AND m.user_id=auth.uid())
);

DROP TRIGGER IF EXISTS trg_bcp_updated_at ON public.borrower_credit_pulls;
CREATE TRIGGER trg_bcp_updated_at BEFORE UPDATE ON public.borrower_credit_pulls
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.borrower_credit_tradelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pull_id uuid NOT NULL REFERENCES public.borrower_credit_pulls(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),

  account_type text,        -- 'mortgage'|'auto_loan'|'credit_card'|'student_loan'|'other'
  creditor_name text,
  account_number_masked text,
  open_date date,
  closed_date date,
  high_credit numeric,
  current_balance numeric,
  monthly_payment numeric,
  payment_history_24mo text, -- e.g. '111111111111111111111111' (1=on time, 2=30day, 3=60day...)
  is_delinquent boolean NOT NULL DEFAULT false,
  is_charged_off boolean NOT NULL DEFAULT false,
  is_in_collection boolean NOT NULL DEFAULT false,

  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bct_pull ON public.borrower_credit_tradelines(pull_id);
CREATE INDEX idx_bct_abnormal ON public.borrower_credit_tradelines(deal_id)
  WHERE is_delinquent OR is_charged_off OR is_in_collection;

ALTER TABLE public.borrower_credit_tradelines ENABLE ROW LEVEL SECURITY;
CREATE POLICY bct_deny ON public.borrower_credit_tradelines FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY bct_select_bank ON public.borrower_credit_tradelines FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id=borrower_credit_tradelines.bank_id AND m.user_id=auth.uid())
);

COMMIT;
