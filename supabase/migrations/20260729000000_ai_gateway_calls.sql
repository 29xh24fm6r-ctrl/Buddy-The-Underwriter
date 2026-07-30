BEGIN;

-- ============================================================
-- SPEC-M1 AI-GATEWAY-1 — ai_gateway_calls ledger table.
--
-- Every LLM call routed through src/lib/ai/gateway.ts (runRole /
-- runRoleStream) writes exactly one row here, success or failure,
-- including calls refused by the NPI-approval gate. This table is both
-- the SR 11-7 model-inventory audit trail and the cost meter behind each
-- role's daily token budget (src/lib/ai/roleConfig.ts).
--
-- Server-only, insert-only from the app (src/lib/ai/ledger.ts uses
-- supabaseAdmin()); no client-side reads/writes are needed for this spec,
-- so RLS is enabled with no policies (deny-all for anon/authenticated).
-- A future admin dashboard (SPEC-M2 BEAT-METRICS-1) can add a read policy
-- scoped to internal admin roles when it needs one.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ai_gateway_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  role text NOT NULL CHECK (role IN ('generator', 'verifier', 'structurer', 'interviewer')),
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
  'SPEC-M1 AI-GATEWAY-1 ledger: one row per LLM call attempt routed through src/lib/ai/gateway.ts. SR 11-7 model-inventory audit trail + per-role cost meter.';
COMMENT ON COLUMN public.ai_gateway_calls.npi_tagged IS
  'True if the request payload was tagged as containing borrower/customer NPI. Refused requests (provider not APPROVED for NPI) are still logged as outcome=failure rows.';
COMMENT ON COLUMN public.ai_gateway_calls.purpose IS
  'Short stable caller-supplied label, e.g. "naics_suggest" or "verify_claims" — not free-form prose.';

CREATE INDEX IF NOT EXISTS ai_gateway_calls_deal_id_idx ON public.ai_gateway_calls (deal_id);
CREATE INDEX IF NOT EXISTS ai_gateway_calls_created_at_idx ON public.ai_gateway_calls (created_at);
CREATE INDEX IF NOT EXISTS ai_gateway_calls_role_created_at_idx ON public.ai_gateway_calls (role, created_at);

ALTER TABLE public.ai_gateway_calls ENABLE ROW LEVEL SECURITY;

COMMIT;
