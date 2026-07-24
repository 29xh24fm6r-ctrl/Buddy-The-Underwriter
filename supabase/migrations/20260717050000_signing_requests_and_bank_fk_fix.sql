BEGIN;

-- ============================================================
-- Fix bank_profiles/banks FK drift (SPEC-SBA-DOC-FILL-ESIGN-KYC-V2, open
-- question #1). bank_document_templates.bank_id and
-- filled_bank_documents.bank_id currently FK to bank_profiles(id) — a
-- table with 0 rows and zero references anywhere in application code.
-- Every other bank-scoped table (deals, signed_documents,
-- borrower_identity_verifications) FKs to banks(id), which is the table
-- application code actually populates and queries (5 rows). As shipped,
-- the bank_profiles FK made any real insert into filled_bank_documents
-- impossible — no bank_profiles row can ever exist to satisfy it. Both
-- tables have 0 rows today, so this is a safe in-place repoint, not a
-- backfill.
-- ============================================================

ALTER TABLE public.bank_document_templates
  DROP CONSTRAINT bank_document_templates_bank_id_fkey;
ALTER TABLE public.bank_document_templates
  ADD CONSTRAINT bank_document_templates_bank_id_fkey
  FOREIGN KEY (bank_id) REFERENCES public.banks(id);

ALTER TABLE public.filled_bank_documents
  DROP CONSTRAINT filled_bank_documents_bank_id_fkey;
ALTER TABLE public.filled_bank_documents
  ADD CONSTRAINT filled_bank_documents_bank_id_fkey
  FOREIGN KEY (bank_id) REFERENCES public.banks(id);

-- open question #2 — bank_document_fill_runs.deal_id had no FK at all
-- (confirmed via pg_constraint). Every fill run is created from a real
-- deal_id in application code (src/app/api/deals/[dealId]/bank-docs/*),
-- so enforcing it now is a safe tightening, not a behavior change.
ALTER TABLE public.bank_document_fill_runs
  ADD CONSTRAINT bank_document_fill_runs_deal_id_fkey
  FOREIGN KEY (deal_id) REFERENCES public.deals(id);

-- ============================================================
-- signing_requests — tracks an in-flight SignWell request between
-- "sent" and "completed". signed_documents requires
-- signed_pdf_storage_path/signature_completed_at NOT NULL, so it can't
-- represent a request that hasn't finished signing yet; this table fills
-- that gap. Completed requests get mirrored into signed_documents by
-- handleSignwellWebhook() (src/lib/esign/signwell/service.ts), which
-- remains the source of truth for executed signatures.
--
-- Scoped to form_code/deal_id/signer_ownership_entity_id rather than a
-- filled_bank_documents FK: the SBA per-form e-sign flow renders its PDF
-- via src/lib/sba/forms/*/render.ts (the tested, IAL2-gated pipeline),
-- which is a separate subsystem from the bank_document_templates ->
-- filled_bank_documents pipeline used by the generic bank-forms mapper
-- (src/lib/bankForms/). filled_bank_document_id stays as an optional
-- pointer for the day those two pipelines converge, but nothing requires
-- it today.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.signing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  filled_bank_document_id uuid REFERENCES public.filled_bank_documents(id),

  form_code text NOT NULL,
  signer_ownership_entity_id uuid REFERENCES public.ownership_entities(id),
  signer_role text,
  recipient_email text,
  recipient_name text,

  provider text NOT NULL DEFAULT 'signwell',
  signwell_document_id text NOT NULL UNIQUE,
  -- Draft, Created, Sending, Sent, Pending, Viewed, Completed,
  -- Manually completed, Declined, Canceled, Bounced, Blocked, Error, Expired
  status text NOT NULL DEFAULT 'Created',
  test_mode boolean NOT NULL DEFAULT false,
  embedded_signing boolean NOT NULL DEFAULT true,
  signing_url text,

  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_last_event jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  signed_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_signing_requests_deal ON public.signing_requests(deal_id);
CREATE INDEX IF NOT EXISTS idx_signing_requests_status ON public.signing_requests(status);
CREATE INDEX IF NOT EXISTS idx_signing_requests_signwell_document_id ON public.signing_requests(signwell_document_id);

DROP TRIGGER IF EXISTS signing_requests_set_updated_at ON public.signing_requests;
CREATE TRIGGER signing_requests_set_updated_at
  BEFORE UPDATE ON public.signing_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.signing_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY sr_deny ON public.signing_requests FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY sr_select_bank ON public.signing_requests FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id = signing_requests.bank_id AND m.user_id = auth.uid())
);

COMMENT ON TABLE public.signing_requests IS
  'In-flight SignWell e-signature requests, from creation through completion. Completed requests are mirrored into signed_documents, which remains the compliance record of executed signatures.';

COMMIT;
