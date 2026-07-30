BEGIN;

-- ============================================================
-- SPEC-GATEWAY-CAPABILITY-EXPANSION-1 §4 — widen ai_gateway_calls.role
-- CHECK to include "embedder".
--
-- Mirrors 20260802000002_ai_gateway_calls_translator_role.sql's widening
-- for "translator". "embedder" is deliberately NOT added to roleConfig.ts's
-- GatewayRole union (src/lib/ai/embed.ts's own doc comment explains why:
-- an embedding has no failover chain and isn't role output text) — this
-- migration only widens the ledger table's constraint so embedText()'s
-- calls (src/lib/ai/embed.ts) can be recorded in the same
-- ai_gateway_calls audit trail as runRole() calls.
-- ============================================================

ALTER TABLE public.ai_gateway_calls
  DROP CONSTRAINT IF EXISTS ai_gateway_calls_role_check;

ALTER TABLE public.ai_gateway_calls
  ADD CONSTRAINT ai_gateway_calls_role_check
  CHECK (role IN ('generator', 'verifier', 'structurer', 'interviewer', 'translator', 'embedder'));

COMMIT;
