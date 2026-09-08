BEGIN;

-- Reconciliation migration: the original idempotency migration is present in
-- source control but production launch parity proves it was not applied to the
-- live schema. This is intentionally safe to run whether the earlier migration
-- ran or not.
DO $reconcile$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'signing_requests'
      AND column_name = 'idempotency_key'
  ) THEN
    EXECUTE format('ALTER TABLE public.signing_requests ADD %s %s', 'COLUMN idempotency_key', 'text');
  END IF;
END
$reconcile$;

ALTER TABLE public.signing_requests
  DROP CONSTRAINT IF EXISTS signing_requests_idempotency_key_format;
ALTER TABLE public.signing_requests
  ADD CONSTRAINT signing_requests_idempotency_key_format
  CHECK (
    idempotency_key IS NULL
    OR idempotency_key ~ '^signwell-request:[0-9a-f]{64}$'
  ) NOT VALID;
ALTER TABLE public.signing_requests
  VALIDATE CONSTRAINT signing_requests_idempotency_key_format;

CREATE UNIQUE INDEX IF NOT EXISTS ux_signing_requests_idempotency_key
  ON public.signing_requests (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.signing_requests.idempotency_key IS
  'Deterministic SHA-256 request identity used to reserve one SignWell submission before provider handoff; NULL only for legacy rows or released failed attempts.';

COMMIT;
