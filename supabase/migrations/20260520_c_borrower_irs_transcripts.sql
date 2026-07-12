BEGIN;

CREATE TABLE IF NOT EXISTS public.borrower_irs_transcript_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),

  -- Either business or individual
  ownership_entity_id uuid REFERENCES public.ownership_entities(id),
  borrower_id uuid REFERENCES public.borrowers(id),

  vendor text NOT NULL DEFAULT 'irs_direct'
    CHECK (vendor IN ('irs_direct','ncs','idology','wolters_kluwer')),
  vendor_request_id text,

  signed_4506c_id uuid REFERENCES public.signed_documents(id),
  tax_years integer[] NOT NULL,
  transcript_types text[] NOT NULL,  -- e.g. ['return','wage_income','account']

  status text NOT NULL DEFAULT 'pending_signature'
    CHECK (status IN ('pending_signature','submitted','received','reconciled','failed','expired')),
  status_reason text,

  submitted_at timestamptz,
  received_at timestamptz,
  next_poll_at timestamptz,
  poll_attempt_count integer NOT NULL DEFAULT 0,

  -- Result
  transcripts_storage_path text,
  reconciliation_summary jsonb,

  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CHECK (ownership_entity_id IS NOT NULL OR borrower_id IS NOT NULL)
);

CREATE INDEX idx_irs_deal ON public.borrower_irs_transcript_requests(deal_id);
CREATE INDEX idx_irs_pending ON public.borrower_irs_transcript_requests(next_poll_at)
  WHERE status='submitted' AND next_poll_at IS NOT NULL;

ALTER TABLE public.borrower_irs_transcript_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY irs_deny ON public.borrower_irs_transcript_requests FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY irs_select ON public.borrower_irs_transcript_requests FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id=borrower_irs_transcript_requests.bank_id AND m.user_id=auth.uid())
);

DROP TRIGGER IF EXISTS trg_irs_updated_at ON public.borrower_irs_transcript_requests;
CREATE TRIGGER trg_irs_updated_at BEFORE UPDATE ON public.borrower_irs_transcript_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
