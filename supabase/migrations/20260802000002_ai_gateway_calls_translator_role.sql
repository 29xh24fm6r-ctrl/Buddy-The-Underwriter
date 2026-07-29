BEGIN;

-- ============================================================
-- public.ai_gateway_calls — widen role CHECK to include "translator".
--
-- History: SPEC-SYSTEM-DEBLOAT-1's first schema-inventory pass had an
-- FK-detection bug that misread this table as having zero FK edges and
-- classified it DROP (a batch-1 migration briefly existed to drop it,
-- authored while SPEC-M1's AI Gateway work was still mid-flight on this
-- unmerged branch stack). That batch-1 migration and its DDL backup have
-- since been removed on `main` (SPEC-SYSTEM-DEBLOAT-1 Phase C1/C2 fix,
-- PR #759) — the corrected FK-aware pass independently reclassified this
-- table **KEEP-STRUCTURAL** (it has a real outbound FK to `deals`), so no
-- recreate/override is needed anymore; this migration was rewritten in
-- place (never applied to any real DB — Matt applies migrations, this
-- branch only authors them) once that landed.
--
-- What's still a real, separate fix: the original CREATE
-- (20260729000000_ai_gateway_calls.sql)'s `role` CHECK constraint never
-- included "translator" (added by SPEC-M3 GLASS-BOX-1, after M1 authored
-- this table) — every translator-role gateway call has been silently
-- failing to write its ledger row (logGatewayCall never throws — see
-- ledger.ts's doc comment — so this was a silent audit-trail gap, not a
-- crash). This migration fixes that.
-- ============================================================

ALTER TABLE public.ai_gateway_calls
  DROP CONSTRAINT IF EXISTS ai_gateway_calls_role_check;

ALTER TABLE public.ai_gateway_calls
  ADD CONSTRAINT ai_gateway_calls_role_check
  CHECK (role IN ('generator', 'verifier', 'structurer', 'interviewer', 'translator'));

COMMIT;
