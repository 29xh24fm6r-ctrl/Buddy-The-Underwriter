-- Borrower email verification codes for the "verify first, then workspace"
-- /start entry flow. A borrower gives name+email before any chat happens;
-- this table holds the hashed 6-digit code sent to confirm they own that
-- email, before a deal/session is ever created for them.
--
-- Service-role-only, same posture as borrower_session_tokens: RLS enabled,
-- zero policies for anon/authenticated (deny-by-default), explicit
-- service_role_all policy matching the convention already applied to
-- brokerage_leads and friends in 20260519140120_rls_service_role_zero_policy_tables.sql.

CREATE TABLE IF NOT EXISTS public.borrower_email_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  email text NOT NULL,
  name text,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS borrower_email_verifications_bank_email_idx
  ON public.borrower_email_verifications (bank_id, lower(email));
CREATE INDEX IF NOT EXISTS borrower_email_verifications_expires_at_idx
  ON public.borrower_email_verifications (expires_at);

COMMENT ON TABLE public.borrower_email_verifications IS
  'Hashed 6-digit email verification codes for the pre-deal /start gate. Never store the raw code — code_hash is SHA-256. Rows expire in ~10 minutes and are purged by the nightly cleanup-expired cron alongside borrower_session_tokens.';

ALTER TABLE public.borrower_email_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON public.borrower_email_verifications
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
