-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for ai_gateway_calls.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f ai_gateway_calls.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.ai_gateway_calls (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  role text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL DEFAULT 0,
  deal_id uuid,
  purpose text NOT NULL,
  npi_tagged boolean NOT NULL DEFAULT false,
  outcome text NOT NULL,
  error_message text,
  CONSTRAINT ai_gateway_calls_outcome_check CHECK ((outcome = ANY (ARRAY['success'::text, 'failure'::text]))),
  CONSTRAINT ai_gateway_calls_pkey PRIMARY KEY (id),
  CONSTRAINT ai_gateway_calls_provider_check CHECK ((provider = ANY (ARRAY['google'::text, 'anthropic'::text, 'openai'::text]))),
  CONSTRAINT ai_gateway_calls_role_check CHECK ((role = ANY (ARRAY['generator'::text, 'verifier'::text, 'structurer'::text, 'interviewer'::text])))
);

CREATE INDEX ai_gateway_calls_deal_id_idx ON public.ai_gateway_calls USING btree (deal_id);
CREATE INDEX ai_gateway_calls_created_at_idx ON public.ai_gateway_calls USING btree (created_at);
CREATE INDEX ai_gateway_calls_role_created_at_idx ON public.ai_gateway_calls USING btree (role, created_at);
