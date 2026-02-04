-- 20260204_extend_deal_loan_requests.sql
-- Extends deal_loan_requests with product-specific fields, status lifecycle,
-- underwriting outputs, and multi-request support.

BEGIN;

-- ============================================
-- 1) Drop old product_type CHECK to allow expanded set
-- ============================================
DO $$
BEGIN
  ALTER TABLE public.deal_loan_requests DROP CONSTRAINT IF EXISTS deal_loan_requests_product_type_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE public.deal_loan_requests
  ADD CONSTRAINT deal_loan_requests_product_type_check
  CHECK (product_type IN (
    -- Original
    'SBA_7A', 'SBA_504', 'CRE_TERM', 'C_AND_I_TERM',
    'LINE_OF_CREDIT', 'EQUIPMENT', 'REFINANCE', 'OTHER',
    -- Real Estate
    'CRE_PURCHASE', 'CRE_REFI', 'CRE_CASH_OUT',
    'CONSTRUCTION', 'LAND', 'BRIDGE',
    -- Lines of Credit
    'LOC_SECURED', 'LOC_UNSECURED', 'LOC_RE_SECURED',
    -- Term Loans
    'TERM_SECURED', 'TERM_UNSECURED', 'VEHICLE', 'WORKING_CAPITAL',
    -- SBA
    'SBA_7A_STANDARD', 'SBA_7A_SMALL', 'SBA_EXPRESS', 'SBA_CAPLines',
    -- Specialty
    'ACQUISITION', 'FRANCHISE', 'ACCOUNTS_RECEIVABLE', 'INVENTORY'
  ));

-- ============================================
-- 2) Core columns
-- ============================================
ALTER TABLE public.deal_loan_requests
  ADD COLUMN IF NOT EXISTS bank_id uuid,
  ADD COLUMN IF NOT EXISTS request_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS loan_purpose text,
  ADD COLUMN IF NOT EXISTS purpose_category text,
  ADD COLUMN IF NOT EXISTS rate_type_preference text,
  ADD COLUMN IF NOT EXISTS request_details jsonb DEFAULT '{}';

DO $$
BEGIN
  ALTER TABLE public.deal_loan_requests
    ADD CONSTRAINT deal_loan_requests_rate_type_preference_check
    CHECK (rate_type_preference IN ('FIXED', 'VARIABLE', 'NO_PREFERENCE') OR rate_type_preference IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 3) Real Estate fields
-- ============================================
ALTER TABLE public.deal_loan_requests
  ADD COLUMN IF NOT EXISTS property_type text,
  ADD COLUMN IF NOT EXISTS occupancy_type text,
  ADD COLUMN IF NOT EXISTS property_value numeric,
  ADD COLUMN IF NOT EXISTS purchase_price numeric,
  ADD COLUMN IF NOT EXISTS down_payment numeric,
  ADD COLUMN IF NOT EXISTS property_noi numeric,
  ADD COLUMN IF NOT EXISTS property_address_json jsonb;

DO $$
BEGIN
  ALTER TABLE public.deal_loan_requests
    ADD CONSTRAINT deal_loan_requests_occupancy_type_check
    CHECK (occupancy_type IN ('OWNER_OCCUPIED', 'INVESTOR', 'MIXED') OR occupancy_type IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 4) SBA fields
-- ============================================
ALTER TABLE public.deal_loan_requests
  ADD COLUMN IF NOT EXISTS sba_program text,
  ADD COLUMN IF NOT EXISTS sba_loan_priority text,
  ADD COLUMN IF NOT EXISTS injection_amount numeric,
  ADD COLUMN IF NOT EXISTS injection_source text;

DO $$
BEGIN
  ALTER TABLE public.deal_loan_requests
    ADD CONSTRAINT deal_loan_requests_sba_program_check
    CHECK (sba_program IN ('7A', '504', 'EXPRESS', 'COMMUNITY_ADVANTAGE') OR sba_program IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 5) Status tracking
-- ============================================
ALTER TABLE public.deal_loan_requests
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';

DO $$
BEGIN
  ALTER TABLE public.deal_loan_requests
    ADD CONSTRAINT deal_loan_requests_status_check
    CHECK (status IN (
      'draft', 'submitted', 'under_review', 'pricing_requested',
      'terms_proposed', 'terms_accepted', 'approved', 'declined',
      'withdrawn', 'funded'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 6) Underwriting outputs
-- ============================================
ALTER TABLE public.deal_loan_requests
  ADD COLUMN IF NOT EXISTS preliminary_decision text,
  ADD COLUMN IF NOT EXISTS approved_amount numeric,
  ADD COLUMN IF NOT EXISTS approved_rate_pct numeric,
  ADD COLUMN IF NOT EXISTS approved_term_months integer,
  ADD COLUMN IF NOT EXISTS approved_amort_months integer,
  ADD COLUMN IF NOT EXISTS decision_notes text,
  ADD COLUMN IF NOT EXISTS decision_at timestamptz,
  ADD COLUMN IF NOT EXISTS decision_by uuid;

DO $$
BEGIN
  ALTER TABLE public.deal_loan_requests
    ADD CONSTRAINT deal_loan_requests_preliminary_decision_check
    CHECK (preliminary_decision IN ('APPROVE', 'DECLINE', 'REFER', 'PENDING') OR preliminary_decision IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 7) Pricing link + Audit
-- ============================================
ALTER TABLE public.deal_loan_requests
  ADD COLUMN IF NOT EXISTS active_quote_id uuid,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'banker';

DO $$
BEGIN
  ALTER TABLE public.deal_loan_requests
    ADD CONSTRAINT deal_loan_requests_source_check
    CHECK (source IN ('banker', 'borrower_portal', 'api', 'system') OR source IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 8) Unique constraint + indexes
-- ============================================
DO $$
BEGIN
  ALTER TABLE public.deal_loan_requests
    ADD CONSTRAINT deal_loan_requests_deal_request_number_unique UNIQUE (deal_id, request_number);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS deal_loan_requests_bank_idx
  ON public.deal_loan_requests(bank_id);
CREATE INDEX IF NOT EXISTS deal_loan_requests_product_idx
  ON public.deal_loan_requests(product_type);
CREATE INDEX IF NOT EXISTS deal_loan_requests_status_idx
  ON public.deal_loan_requests(status);

-- ============================================
-- 9) Backfill request_number for existing rows
-- ============================================
DO $$
DECLARE
  r RECORD;
  seq integer;
  prev_deal uuid := NULL;
BEGIN
  seq := 0;
  FOR r IN
    SELECT id, deal_id FROM public.deal_loan_requests
    ORDER BY deal_id, created_at ASC
  LOOP
    IF r.deal_id IS DISTINCT FROM prev_deal THEN
      seq := 1;
      prev_deal := r.deal_id;
    ELSE
      seq := seq + 1;
    END IF;
    UPDATE public.deal_loan_requests SET request_number = seq WHERE id = r.id;
  END LOOP;
END $$;

COMMIT;
