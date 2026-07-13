BEGIN;

CREATE TABLE IF NOT EXISTS public.signed_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),

  form_code text NOT NULL,         -- 'FORM_1919'|'FORM_413'|'FORM_4506C'|...
  template_version text NOT NULL,

  signer_ownership_entity_id uuid REFERENCES public.ownership_entities(id),
  signer_role text NOT NULL
    CHECK (signer_role IN ('applicant','guarantor','spouse','agent','witness')),

  -- IAL2 evidence chain — REQUIRED, no exceptions
  identity_verification_id uuid NOT NULL
    REFERENCES public.borrower_identity_verifications(id),

  docuseal_submission_id text NOT NULL,
  docuseal_submitter_id text NOT NULL,

  signed_pdf_storage_path text NOT NULL,
  audit_trail_storage_path text NOT NULL,

  signature_request_sent_at timestamptz NOT NULL,
  signature_completed_at timestamptz NOT NULL,

  -- SBA form staleness (90 days for 1919/413; 120 for 4506-C)
  staleness_window_days integer NOT NULL DEFAULT 90,
  expires_at timestamptz NOT NULL,

  signer_ip text,
  signer_user_agent text,

  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(deal_id, form_code, signer_ownership_entity_id, signature_completed_at)
);

CREATE INDEX idx_sd_deal ON public.signed_documents(deal_id);
CREATE INDEX idx_sd_form ON public.signed_documents(deal_id, form_code);
CREATE INDEX idx_sd_signer ON public.signed_documents(signer_ownership_entity_id);
-- Spec's original predicate `WHERE expires_at > NOW()` fails at apply time:
-- NOW() is not IMMUTABLE, and Postgres partial-index predicates must be.
-- Index on the plain column instead; "close to expiring" filtering happens
-- at query time in staleSignatureChecker.ts, which is the only place that
-- needs it.
CREATE INDEX idx_sd_expiring ON public.signed_documents(expires_at);

ALTER TABLE public.signed_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY sd_deny ON public.signed_documents FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY sd_select_bank ON public.signed_documents FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id=signed_documents.bank_id AND m.user_id=auth.uid())
);

COMMENT ON TABLE public.signed_documents IS
  'Executed SBA form signatures. Every row references the IAL2 verification that gated the ceremony. SOP 50 10 8 Appendix 10 compliance artifact.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('signed-documents', 'signed-documents', false, 52428800, ARRAY['application/pdf','application/json'])
ON CONFLICT (id) DO NOTHING;

COMMIT;
