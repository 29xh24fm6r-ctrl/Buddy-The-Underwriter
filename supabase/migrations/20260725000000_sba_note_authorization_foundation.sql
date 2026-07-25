BEGIN;

-- ============================================================
-- SBA Note + Loan Authorization & Agreement — foundation.
--
-- Buddy previously generated the full SBA application/disclosure package
-- (1919, 1244, 413, 912, 4506-C, 155, 159, 148/148L, 601, 722) but never
-- the two documents that actually close a loan: the promissory Note and
-- the Loan Authorization & Agreement. Both are lender-drafted legal
-- instruments (no single official fillable PDF to fill, unlike the 11
-- forms above), so Buddy generates them from deal data using standard SBA
-- Note/Authorization structure. Because that's genuinely drafted legal
-- content (not just data mapped into government-fixed fields), every
-- generated document is gated behind an explicit attorney/compliance
-- review before it can be sent for signature — see
-- src/lib/sba/legalReview/service.ts.
-- ============================================================

-- 1. Loan-term fields not otherwise captured: these aren't deal-specific
-- facts to interview the borrower about, they're standard SBA policy
-- (payment cadence, late-charge language, prepayment-penalty schedule).
-- Nullable overrides so a banker can substitute deal-specific language;
-- the build layer supplies the SBA-standard default when null.
ALTER TABLE public.deal_loan_requests
  ADD COLUMN IF NOT EXISTS payment_frequency text
    CHECK (payment_frequency IN ('monthly','quarterly','semi-annually','annually')),
  ADD COLUMN IF NOT EXISTS late_charge_override_text text,
  ADD COLUMN IF NOT EXISTS prepayment_penalty_override_text text;

COMMENT ON COLUMN public.deal_loan_requests.payment_frequency IS
  'Note payment cadence. Defaults to monthly (SBA standard) when null — see sbaNote/fields.ts.';
COMMENT ON COLUMN public.deal_loan_requests.late_charge_override_text IS
  'Banker-supplied override for the Note''s late-charge clause. Null uses the standard SBA late-charge language.';
COMMENT ON COLUMN public.deal_loan_requests.prepayment_penalty_override_text IS
  'Banker-supplied override for the Note''s prepayment-penalty clause. Null uses the standard SBA declining-schedule language computed from term/rate type.';

-- 2. Legal-review gate — one row per (deal, form_code), mirrors the
-- fail-closed shape of the IAL2 gate (hasValidIal2 in
-- src/lib/identity/kyc/service.ts): no row or status != 'approved' means
-- requestSignature() must refuse to send.
CREATE TABLE IF NOT EXISTS public.sba_legal_document_reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id      uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id      uuid NOT NULL REFERENCES public.banks(id),
  form_code    text NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved')),
  reviewed_by  text,
  reviewed_at  timestamptz,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(deal_id, form_code)
);

CREATE INDEX IF NOT EXISTS idx_sldr_deal ON public.sba_legal_document_reviews(deal_id);

ALTER TABLE public.sba_legal_document_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY sldr_deny ON public.sba_legal_document_reviews FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY sldr_select_bank ON public.sba_legal_document_reviews FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id = sba_legal_document_reviews.bank_id AND m.user_id = auth.uid())
);

COMMENT ON TABLE public.sba_legal_document_reviews IS
  'Attorney/compliance sign-off gate for Buddy-generated closing documents (SBA Note, Loan Authorization) before they may be sent for e-signature. Service-role writes only — see src/lib/sba/legalReview/service.ts.';

COMMIT;
