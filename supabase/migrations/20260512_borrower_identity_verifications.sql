BEGIN;

CREATE TABLE IF NOT EXISTS public.borrower_identity_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  ownership_entity_id uuid NOT NULL REFERENCES public.ownership_entities(id) ON DELETE CASCADE,

  vendor text NOT NULL DEFAULT 'persona'
    CHECK (vendor IN ('persona','stripe_identity','jumio','veriff')),
  vendor_inquiry_id text NOT NULL,
  vendor_template_id text,
  vendor_session_token_hash text,

  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','pending','completed','approved','failed','expired','declined','needs_review')),
  status_reason text,

  -- IAL2 evidence (references; full artifacts at vendor)
  id_document_type text,    -- 'drivers_license'|'passport'|'state_id'
  id_document_country text, -- ISO 3166
  id_document_state text,
  id_document_first_name text,
  id_document_last_name text,
  id_document_dob_year integer,  -- year only; full DOB at vendor

  selfie_match_score numeric,
  liveness_passed boolean,

  -- Storage refs (never raw images on Buddy side)
  id_image_storage_path text,
  selfie_image_storage_path text,
  vendor_artifacts_url text,  -- Persona inquiry URL for examiner audit

  initiated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  initiator_user_id text,
  initiator_ip text,
  initiator_user_agent text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(deal_id, ownership_entity_id, vendor_inquiry_id)
);

CREATE INDEX idx_biv_deal ON public.borrower_identity_verifications(deal_id);
CREATE INDEX idx_biv_entity ON public.borrower_identity_verifications(ownership_entity_id);
CREATE INDEX idx_biv_status_pending ON public.borrower_identity_verifications(status)
  WHERE status IN ('created','pending');
CREATE INDEX idx_biv_completed ON public.borrower_identity_verifications(deal_id, ownership_entity_id, completed_at DESC)
  WHERE status IN ('completed','approved');

ALTER TABLE public.borrower_identity_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY biv_deny ON public.borrower_identity_verifications
  FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY biv_select_bank ON public.borrower_identity_verifications
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.bank_user_memberships m
      WHERE m.bank_id=borrower_identity_verifications.bank_id AND m.user_id=auth.uid())
  );

DROP TRIGGER IF EXISTS trg_biv_updated_at ON public.borrower_identity_verifications;
CREATE TRIGGER trg_biv_updated_at BEFORE UPDATE ON public.borrower_identity_verifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.borrower_identity_verifications IS
  'IAL2 identity verification artifacts per ownership_entity per deal. Required gate for SBA e-signature per SOP 50 10 8 Appendix 10.';

COMMIT;
