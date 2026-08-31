BEGIN;

-- New requests receive a deterministic key before any provider side effect.
-- Existing rows remain NULL, so deployment does not rewrite or deduplicate
-- historical signing evidence.
ALTER TABLE public.signing_requests
  ADD COLUMN IF NOT EXISTS idempotency_key text;

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

-- A partial index keeps historical NULL rows out of the lock while making
-- every new deterministic reservation globally unique. The key remains on
-- active/completed requests and is cleared only after a failed terminal
-- outcome so an explicitly controlled retry can reserve again.
CREATE UNIQUE INDEX IF NOT EXISTS ux_signing_requests_idempotency_key
  ON public.signing_requests (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.signing_requests.idempotency_key IS
  'Deterministic SHA-256 request identity used to reserve one SignWell submission before provider handoff; NULL only for legacy rows or released failed attempts.';

COMMIT;
