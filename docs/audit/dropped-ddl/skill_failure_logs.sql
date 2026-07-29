-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for skill_failure_logs.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f skill_failure_logs.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.skill_failure_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  skill_id text NOT NULL,
  user_id text NOT NULL,
  failure_type text NOT NULL,
  context jsonb NOT NULL,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT skill_failure_logs_failure_type_check CHECK ((failure_type = ANY (ARRAY['user_pushback'::text, 'peis_low_quality'::text, 'execution_error'::text, 'outcome_miss'::text, 'repeated_failure'::text]))),
  CONSTRAINT skill_failure_logs_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_skill_failure_logs_skill ON public.skill_failure_logs USING btree (skill_id, created_at DESC);
