-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for brain_thought_artifacts.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f brain_thought_artifacts.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.brain_thought_artifacts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  loop_id uuid NOT NULL,
  kind text NOT NULL,
  input_packet jsonb NOT NULL,
  output jsonb NOT NULL,
  confidence numeric NOT NULL,
  uncertainty_flags text[] NOT NULL DEFAULT '{}'::text[],
  model text NOT NULL,
  latency_ms integer NOT NULL DEFAULT 0,
  token_estimate integer NOT NULL DEFAULT 0,
  checksum text NOT NULL,
  CONSTRAINT brain_thought_artifacts_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
  CONSTRAINT brain_thought_artifacts_kind_check CHECK ((kind = ANY (ARRAY['reasoning'::text, 'simulation'::text, 'reflection'::text]))),
  CONSTRAINT brain_thought_artifacts_pkey PRIMARY KEY (id)
);
