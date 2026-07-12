-- ARC-00 Phase 6 (SPEC S5) B-1 — AP-3 finding: a legacy `etran_submissions`
-- table already existed in prod (columns: application_id, xml,
-- submitted_at, status, reference_id, error, created_at, updated_at — 0
-- rows, clearly an earlier abandoned scaffold, not this spec's schema).
-- `CREATE TABLE IF NOT EXISTS` silently no-op'd against it, then
-- `CREATE INDEX ...(deal_id)` failed because the legacy table has no
-- deal_id column. Renamed to `sba_etran_submissions` (matching the
-- `sba_`-prefix convention `sba_package_runs`/`sba_package_items` already
-- use) rather than dropping/altering the legacy table — non-destructive.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.bank_etran_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id uuid NOT NULL UNIQUE REFERENCES public.banks(id) ON DELETE CASCADE,

  sba_lender_id text NOT NULL,
  sba_service_center text NOT NULL,

  client_cert_pem_encrypted bytea NOT NULL,
  client_key_pem_encrypted bytea NOT NULL,

  endpoint_environment text NOT NULL DEFAULT 'sandbox'
    CHECK (endpoint_environment IN ('sandbox','production')),

  cert_expires_at timestamptz,
  last_rotation_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bank_etran_credentials ENABLE ROW LEVEL SECURITY;
-- DENY ALL — only service role access. No row-level read for any user.
CREATE POLICY bec_deny ON public.bank_etran_credentials
  FOR ALL USING (false) WITH CHECK (false);

DROP TRIGGER IF EXISTS trg_bec_updated_at ON public.bank_etran_credentials;
CREATE TRIGGER trg_bec_updated_at BEFORE UPDATE ON public.bank_etran_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.sba_etran_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  truth_snapshot_id uuid REFERENCES public.deal_truth_snapshots(id),

  status text NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared','submitted','accepted','rejected','error')),
  status_reason text,

  xml_storage_path text NOT NULL,
  response_storage_path text,

  sba_application_number text,
  endpoint_environment text NOT NULL CHECK (endpoint_environment IN ('sandbox','production')),

  approved_by_user_id text NOT NULL,
  approved_at timestamptz NOT NULL,
  submitted_at timestamptz,
  responded_at timestamptz,

  validation_passed boolean NOT NULL,
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,

  idempotency_key text NOT NULL UNIQUE,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ses_deal ON public.sba_etran_submissions(deal_id);
CREATE INDEX idx_ses_bank ON public.sba_etran_submissions(bank_id, submitted_at DESC);

ALTER TABLE public.sba_etran_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY ses_deny ON public.sba_etran_submissions FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY ses_select_bank ON public.sba_etran_submissions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id=sba_etran_submissions.bank_id AND m.user_id=auth.uid())
);

DROP TRIGGER IF EXISTS trg_ses_updated_at ON public.sba_etran_submissions;
CREATE TRIGGER trg_ses_updated_at BEFORE UPDATE ON public.sba_etran_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
