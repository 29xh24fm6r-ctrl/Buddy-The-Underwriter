BEGIN;

-- ============================================================
-- RECREATE public.ai_gateway_calls — SPEC-SYSTEM-DEBLOAT-1 / SPEC-M1
-- AI-GATEWAY-1 cross-program conflict, flagged by guard:dropped-tables.
--
-- What happened: SPEC-SYSTEM-DEBLOAT-1's schema-inventory audit
-- (docs/audit/schema-inventory-2026-07.md) ran against `main`, where
-- SPEC-M1's AI Gateway work (src/lib/ai/gateway.ts, ledger.ts, and this
-- table) did not exist yet — M1-M7 have been developed as a stack of
-- unmerged feature branches per this program's "one spec in flight"
-- workflow. From main's perspective at audit time, ai_gateway_calls
-- genuinely had zero code references, zero rows, zero dependents — a
-- correct call given what was actually on main. Batch 1
-- (20260729010000_schema_reap_batch_1.sql) then DROPped it.
--
-- This is exactly the situation guard-dropped-tables.mjs's own error
-- message describes: "if the table is genuinely needed again, that's a
-- new migration + inventory update, not a revert." This migration is
-- that new migration — same schema as the original
-- 20260729000000_ai_gateway_calls.sql, applied with a later timestamp so
-- it runs after the batch-1 DROP in migration order. The corresponding
-- inventory-doc update lives in docs/audit/schema-inventory-2026-07.md.
--
-- Also fixes a real, separate pre-existing gap surfaced while recreating
-- this table: the `role` CHECK constraint never included "translator"
-- (added by SPEC-M3 GLASS-BOX-1, after M1 authored this table) — every
-- translator-role gateway call has been silently failing to write its
-- ledger row (logGatewayCall never throws — see ledger.ts's doc
-- comment — so this was a silent audit-trail gap, not a crash). Fixed
-- here since the table is being recreated regardless.
--
-- IMPORTANT FOR MATT: this only resolves the conflict for whichever
-- branch in the M1-M7 stack merges first. Once merged to main, any
-- sibling branch still being developed off an older base should rebase
-- onto the post-merge main (which will include this recreate migration)
-- rather than re-authoring its own CREATE for this table.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ai_gateway_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  role text NOT NULL CHECK (role IN ('generator', 'verifier', 'structurer', 'interviewer', 'translator')),
  provider text NOT NULL CHECK (provider IN ('google', 'anthropic', 'openai')),
  model text NOT NULL,
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL DEFAULT 0,
  deal_id uuid NULL REFERENCES public.deals(id) ON DELETE SET NULL,
  purpose text NOT NULL,
  npi_tagged boolean NOT NULL DEFAULT false,
  outcome text NOT NULL CHECK (outcome IN ('success', 'failure')),
  error_message text NULL
);

COMMENT ON TABLE public.ai_gateway_calls IS
  'SPEC-M1 AI-GATEWAY-1 ledger: one row per LLM call attempt routed through src/lib/ai/gateway.ts. SR 11-7 model-inventory audit trail + per-role cost meter. Recreated by 20260802000002 after an inter-program schema-audit conflict with SPEC-SYSTEM-DEBLOAT-1 batch 1 — see that migration''s comment.';
COMMENT ON COLUMN public.ai_gateway_calls.npi_tagged IS
  'True if the request payload was tagged as containing borrower/customer NPI. Refused requests (provider not APPROVED for NPI) are still logged as outcome=failure rows.';
COMMENT ON COLUMN public.ai_gateway_calls.purpose IS
  'Short stable caller-supplied label, e.g. "naics_suggest" or "verify_claims" — not free-form prose.';

CREATE INDEX IF NOT EXISTS ai_gateway_calls_deal_id_idx ON public.ai_gateway_calls (deal_id);
CREATE INDEX IF NOT EXISTS ai_gateway_calls_created_at_idx ON public.ai_gateway_calls (created_at);
CREATE INDEX IF NOT EXISTS ai_gateway_calls_role_created_at_idx ON public.ai_gateway_calls (role, created_at);

ALTER TABLE public.ai_gateway_calls ENABLE ROW LEVEL SECURITY;

COMMIT;
