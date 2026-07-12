-- SPEC S2 A-3 — Plaid soft-data tables: connections (consent-captured
-- Plaid Items), accounts, and classified transactions. Bank-scoped RLS
-- (deny-default + bank_user_memberships-gated SELECT); writes happen only
-- via the service-role client in src/lib/integrations/plaid/.
BEGIN;

CREATE TABLE IF NOT EXISTS public.borrower_bank_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  borrower_id uuid REFERENCES public.borrowers(id) ON DELETE SET NULL,
  ownership_entity_id uuid REFERENCES public.ownership_entities(id) ON DELETE SET NULL,

  plaid_item_id text NOT NULL,
  plaid_access_token_encrypted text NOT NULL,
  plaid_institution_id text,
  plaid_institution_name text,
  account_count integer NOT NULL DEFAULT 0,
  earliest_transaction_date date,
  latest_transaction_date date,

  -- Consent capture (FCRA-equivalent for soft data)
  consent_version text NOT NULL,
  consent_text_hash text NOT NULL,
  consent_ip text,
  consent_user_agent text,
  consent_at timestamptz NOT NULL DEFAULT now(),

  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','expired','revoked','error')),
  last_sync_at timestamptz,
  last_sync_error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(deal_id, plaid_item_id)
);
CREATE INDEX IF NOT EXISTS idx_bbc_deal ON public.borrower_bank_connections(deal_id);
CREATE INDEX IF NOT EXISTS idx_bbc_active ON public.borrower_bank_connections(status) WHERE status='active';

CREATE TABLE IF NOT EXISTS public.borrower_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.borrower_bank_connections(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  plaid_account_id text NOT NULL,
  account_mask text,
  account_official_name text,
  account_type text NOT NULL,
  account_subtype text,
  current_balance numeric,
  available_balance numeric,
  iso_currency_code text NOT NULL DEFAULT 'USD',
  last_balance_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(connection_id, plaid_account_id)
);
CREATE INDEX IF NOT EXISTS idx_bba_deal ON public.borrower_bank_accounts(deal_id);

CREATE TABLE IF NOT EXISTS public.borrower_bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.borrower_bank_accounts(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  plaid_transaction_id text NOT NULL UNIQUE,
  posted_date date NOT NULL,
  authorized_date date,
  amount numeric NOT NULL,    -- Plaid: positive=debit, negative=credit
  iso_currency_code text NOT NULL DEFAULT 'USD',
  merchant_name text,
  description text,
  category_primary text,
  category_detailed text,
  is_pending boolean NOT NULL DEFAULT false,
  derived_category text,    -- 'recurring_payment'|'payroll'|'rent'|'mca'|'transfer'|'sba_loan_payment'
  derived_recurrence text,  -- 'monthly'|'biweekly'|'weekly'|'irregular'
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bbt_deal_date ON public.borrower_bank_transactions(deal_id, posted_date DESC);
CREATE INDEX IF NOT EXISTS idx_bbt_derived ON public.borrower_bank_transactions(deal_id, derived_category)
  WHERE derived_category IS NOT NULL;

ALTER TABLE public.borrower_bank_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.borrower_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.borrower_bank_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bbc_deny ON public.borrower_bank_connections;
CREATE POLICY bbc_deny ON public.borrower_bank_connections FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS bbc_select ON public.borrower_bank_connections;
CREATE POLICY bbc_select ON public.borrower_bank_connections FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id=borrower_bank_connections.bank_id AND m.user_id=auth.uid()));

DROP POLICY IF EXISTS bba_deny ON public.borrower_bank_accounts;
CREATE POLICY bba_deny ON public.borrower_bank_accounts FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS bba_select ON public.borrower_bank_accounts;
CREATE POLICY bba_select ON public.borrower_bank_accounts FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id=borrower_bank_accounts.bank_id AND m.user_id=auth.uid()));

DROP POLICY IF EXISTS bbt_deny ON public.borrower_bank_transactions;
CREATE POLICY bbt_deny ON public.borrower_bank_transactions FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS bbt_select ON public.borrower_bank_transactions;
CREATE POLICY bbt_select ON public.borrower_bank_transactions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id=borrower_bank_transactions.bank_id AND m.user_id=auth.uid()));

DROP TRIGGER IF EXISTS trg_bbc_updated_at ON public.borrower_bank_connections;
CREATE TRIGGER trg_bbc_updated_at BEFORE UPDATE ON public.borrower_bank_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_bba_updated_at ON public.borrower_bank_accounts;
CREATE TRIGGER trg_bba_updated_at BEFORE UPDATE ON public.borrower_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
