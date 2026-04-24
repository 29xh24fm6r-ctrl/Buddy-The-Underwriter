-- ============================================================================
-- Sprint 5: Sealing + Marketplace Listings + Key Facts Summary
-- ============================================================================

-- 1. Sealed packages — immutable snapshot at seal time.
CREATE TABLE IF NOT EXISTS public.buddy_sealed_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id),
  bank_id uuid NOT NULL REFERENCES public.banks(id),

  sealed_snapshot jsonb NOT NULL,

  -- Final-mode artifact paths. NULL at sealing; populated at pick (Sprint 6).
  final_business_plan_path text,
  final_projections_path text,
  final_feasibility_path text,
  final_credit_memo_path text,
  final_forms_path text,
  final_source_docs_zip_path text,

  sealed_at timestamptz NOT NULL DEFAULT now(),
  unsealed_at timestamptz,
  unseal_reason text
);

-- S5-1: btree_gist NOT installed. Partial unique index instead of EXCLUDE.
CREATE UNIQUE INDEX IF NOT EXISTS buddy_sealed_packages_one_active_per_deal
  ON public.buddy_sealed_packages (deal_id)
  WHERE unsealed_at IS NULL;

CREATE INDEX IF NOT EXISTS buddy_sealed_packages_deal_id_idx
  ON public.buddy_sealed_packages (deal_id);
CREATE INDEX IF NOT EXISTS buddy_sealed_packages_sealed_at_idx
  ON public.buddy_sealed_packages (sealed_at);

ALTER TABLE public.buddy_sealed_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sealed_packages_select_for_bank_members ON public.buddy_sealed_packages;
CREATE POLICY sealed_packages_select_for_bank_members
  ON public.buddy_sealed_packages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id = buddy_sealed_packages.bank_id
      AND m.user_id = auth.uid()
  ));

COMMENT ON TABLE public.buddy_sealed_packages IS
  'Immutable snapshot at seal time. One active row per deal (unsealed_at IS NULL). Re-sealing requires prior row to have unsealed_at set.';

-- 2. Marketplace listings.
CREATE TABLE IF NOT EXISTS public.marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sealed_package_id uuid NOT NULL REFERENCES public.buddy_sealed_packages(id),
  deal_id uuid NOT NULL REFERENCES public.deals(id),

  kfs jsonb NOT NULL,
  kfs_redaction_version text NOT NULL DEFAULT '1.0.0',

  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  band text NOT NULL CHECK (band IN (
    'institutional_prime','strong_fit','selective_fit','specialty_lender'
  )),

  rate_card_tier text NOT NULL CHECK (rate_card_tier IN (
    'best','standard','widened','widest'
  )),
  published_rate_bps integer NOT NULL,
  sba_program text NOT NULL CHECK (sba_program IN ('7a','504','express')),
  loan_amount numeric NOT NULL,
  term_months integer NOT NULL,

  matched_lender_bank_ids uuid[] NOT NULL DEFAULT '{}',

  preview_opens_at timestamptz NOT NULL,
  claim_opens_at timestamptz NOT NULL,
  claim_closes_at timestamptz NOT NULL,

  status text NOT NULL DEFAULT 'pending_preview' CHECK (status IN (
    'pending_preview','previewing','claiming',
    'awaiting_borrower_pick','picked','expired','relisted'
  )),

  rolled_count integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  picked_at timestamptz,
  expired_at timestamptz
);

CREATE INDEX IF NOT EXISTS marketplace_listings_deal_id_idx ON public.marketplace_listings (deal_id);
CREATE INDEX IF NOT EXISTS marketplace_listings_status_idx ON public.marketplace_listings (status);
CREATE INDEX IF NOT EXISTS marketplace_listings_preview_opens_at_idx ON public.marketplace_listings (preview_opens_at);
CREATE INDEX IF NOT EXISTS marketplace_listings_claim_opens_at_idx ON public.marketplace_listings (claim_opens_at);

ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;

-- Brokerage ops sees all listings.
DROP POLICY IF EXISTS listings_select_for_brokerage_ops ON public.marketplace_listings;
CREATE POLICY listings_select_for_brokerage_ops
  ON public.marketplace_listings FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    JOIN public.banks b ON b.id = m.bank_id
    WHERE m.user_id = auth.uid() AND b.bank_kind = 'brokerage'
  ));

-- NOTE: S5-4 lender RLS policy DEFERRED to Sprint 4 (when LMA tables land).

COMMENT ON TABLE public.marketplace_listings IS
  'Public-face sealed deal. KFS is borrower-redacted. Lender RLS added in Sprint 4.';

-- 3. Rate card.
CREATE TABLE IF NOT EXISTS public.marketplace_rate_card (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,

  score_band text NOT NULL CHECK (score_band IN (
    'institutional_prime','strong_fit','selective_fit','specialty_lender'
  )),
  sba_program text NOT NULL CHECK (sba_program IN ('7a','504','express')),
  loan_amount_tier text NOT NULL CHECK (loan_amount_tier IN (
    '<350K','350K-1M','1M-5M','>5M'
  )),
  term_tier text NOT NULL CHECK (term_tier IN ('<=7yr','7-15yr','>15yr')),

  spread_bps_over_prime integer NOT NULL,
  notes text,

  UNIQUE (version, score_band, sba_program, loan_amount_tier, term_tier)
);

CREATE INDEX IF NOT EXISTS marketplace_rate_card_version_idx ON public.marketplace_rate_card (version);

ALTER TABLE public.marketplace_rate_card ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rate_card_select_for_brokerage_ops ON public.marketplace_rate_card;
CREATE POLICY rate_card_select_for_brokerage_ops
  ON public.marketplace_rate_card FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    JOIN public.banks b ON b.id = m.bank_id
    WHERE m.user_id = auth.uid() AND b.bank_kind = 'brokerage'
  ));

-- Seed v1.0.0 with PLACEHOLDER spreads. P0 blocker: counsel review required.
INSERT INTO public.marketplace_rate_card (
  version, score_band, sba_program, loan_amount_tier, term_tier,
  spread_bps_over_prime, notes
) VALUES
  ('1.0.0','institutional_prime','7a','<350K','<=7yr',     275,'PLACEHOLDER — counsel review required'),
  ('1.0.0','institutional_prime','7a','<350K','7-15yr',    300,'PLACEHOLDER'),
  ('1.0.0','institutional_prime','7a','350K-1M','<=7yr',   250,'PLACEHOLDER'),
  ('1.0.0','institutional_prime','7a','350K-1M','7-15yr',  275,'PLACEHOLDER'),
  ('1.0.0','institutional_prime','7a','1M-5M','<=7yr',     225,'PLACEHOLDER'),
  ('1.0.0','institutional_prime','7a','1M-5M','7-15yr',    250,'PLACEHOLDER'),
  ('1.0.0','institutional_prime','7a','>5M','<=7yr',       225,'PLACEHOLDER'),
  ('1.0.0','institutional_prime','7a','>5M','7-15yr',      250,'PLACEHOLDER'),
  ('1.0.0','institutional_prime','504','1M-5M','>15yr',    225,'PLACEHOLDER'),
  ('1.0.0','institutional_prime','504','>5M','>15yr',      225,'PLACEHOLDER'),
  ('1.0.0','institutional_prime','express','<350K','<=7yr',325,'PLACEHOLDER'),
  ('1.0.0','strong_fit','7a','<350K','<=7yr',     325,'PLACEHOLDER'),
  ('1.0.0','strong_fit','7a','<350K','7-15yr',    350,'PLACEHOLDER'),
  ('1.0.0','strong_fit','7a','350K-1M','<=7yr',   300,'PLACEHOLDER'),
  ('1.0.0','strong_fit','7a','350K-1M','7-15yr',  325,'PLACEHOLDER'),
  ('1.0.0','strong_fit','7a','1M-5M','<=7yr',     275,'PLACEHOLDER'),
  ('1.0.0','strong_fit','7a','1M-5M','7-15yr',    300,'PLACEHOLDER'),
  ('1.0.0','strong_fit','7a','>5M','<=7yr',       275,'PLACEHOLDER'),
  ('1.0.0','strong_fit','7a','>5M','7-15yr',      300,'PLACEHOLDER'),
  ('1.0.0','strong_fit','504','1M-5M','>15yr',    275,'PLACEHOLDER'),
  ('1.0.0','strong_fit','504','>5M','>15yr',      275,'PLACEHOLDER'),
  ('1.0.0','strong_fit','express','<350K','<=7yr',375,'PLACEHOLDER'),
  ('1.0.0','selective_fit','7a','<350K','<=7yr',     375,'PLACEHOLDER'),
  ('1.0.0','selective_fit','7a','<350K','7-15yr',    400,'PLACEHOLDER'),
  ('1.0.0','selective_fit','7a','350K-1M','<=7yr',   350,'PLACEHOLDER'),
  ('1.0.0','selective_fit','7a','350K-1M','7-15yr',  375,'PLACEHOLDER'),
  ('1.0.0','selective_fit','7a','1M-5M','<=7yr',     325,'PLACEHOLDER'),
  ('1.0.0','selective_fit','7a','1M-5M','7-15yr',    350,'PLACEHOLDER'),
  ('1.0.0','selective_fit','7a','>5M','<=7yr',       325,'PLACEHOLDER'),
  ('1.0.0','selective_fit','7a','>5M','7-15yr',      350,'PLACEHOLDER'),
  ('1.0.0','selective_fit','504','1M-5M','>15yr',    325,'PLACEHOLDER'),
  ('1.0.0','selective_fit','504','>5M','>15yr',      325,'PLACEHOLDER'),
  ('1.0.0','selective_fit','express','<350K','<=7yr',425,'PLACEHOLDER'),
  ('1.0.0','specialty_lender','7a','<350K','<=7yr',     450,'PLACEHOLDER'),
  ('1.0.0','specialty_lender','7a','<350K','7-15yr',    475,'PLACEHOLDER'),
  ('1.0.0','specialty_lender','7a','350K-1M','<=7yr',   425,'PLACEHOLDER'),
  ('1.0.0','specialty_lender','7a','350K-1M','7-15yr',  450,'PLACEHOLDER'),
  ('1.0.0','specialty_lender','7a','1M-5M','<=7yr',     400,'PLACEHOLDER'),
  ('1.0.0','specialty_lender','7a','1M-5M','7-15yr',    425,'PLACEHOLDER'),
  ('1.0.0','specialty_lender','7a','>5M','<=7yr',       400,'PLACEHOLDER'),
  ('1.0.0','specialty_lender','7a','>5M','7-15yr',      425,'PLACEHOLDER'),
  ('1.0.0','specialty_lender','504','1M-5M','>15yr',    400,'PLACEHOLDER'),
  ('1.0.0','specialty_lender','504','>5M','>15yr',      400,'PLACEHOLDER'),
  ('1.0.0','specialty_lender','express','<350K','<=7yr',500,'PLACEHOLDER')
ON CONFLICT DO NOTHING;
