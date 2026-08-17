BEGIN;

ALTER TABLE public.ai_gateway_calls
  DROP CONSTRAINT IF EXISTS ai_gateway_calls_role_check;

ALTER TABLE public.ai_gateway_calls
  ADD CONSTRAINT ai_gateway_calls_role_check
  CHECK (role IN (
    'generator', 'verifier', 'structurer', 'interviewer', 'translator',
    'embedder', 'evidence', 'underwriter'
  ));

COMMIT;
