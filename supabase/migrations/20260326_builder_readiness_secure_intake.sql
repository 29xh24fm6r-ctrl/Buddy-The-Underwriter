-- Phase 56B: Builder Readiness, Borrower Activation & Secure Intake

-- 1. Secure PII records (never store plaintext SSN/TIN in builder sections)
CREATE TABLE IF NOT EXISTS public.deal_pii_records (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id              uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  ownership_entity_id  uuid REFERENCES public.ownership_entities(id),
  pii_type             text NOT NULL CHECK (pii_type IN ('full_ssn','full_tin','dob_verified','identity_ref')),
  encrypted_payload    text NOT NULL,
  last4                text,
  token_provider       text,
  external_ref         text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dpr_deal_id ON public.deal_pii_records(deal_id);
CREATE INDEX IF NOT EXISTS idx_dpr_entity_id ON public.deal_pii_records(ownership_entity_id);

-- 2. Builder submissions (tracks submit-to-credit, borrower-app-submit, docs-launch)
CREATE TABLE IF NOT EXISTS public.deal_builder_submissions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id           uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  submitted_by      text NOT NULL,
  submitted_from    text NOT NULL CHECK (submitted_from IN ('banker','borrower')),
  submission_type   text NOT NULL CHECK (submission_type IN ('credit','borrower_application','docs_launch')),
  status            text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','accepted','rejected','withdrawn')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dbs_deal_id ON public.deal_builder_submissions(deal_id);

-- RLS
ALTER TABLE public.deal_pii_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_builder_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON public.deal_pii_records FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON public.deal_builder_submissions FOR ALL USING (true) WITH CHECK (true);
