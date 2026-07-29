-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for rule_evaluation_runs.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f rule_evaluation_runs.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.rule_evaluation_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  rule_set_key text NOT NULL,
  rule_version text NOT NULL,
  ran_at timestamp with time zone NOT NULL DEFAULT now(),
  outcome jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT rule_evaluation_runs_pkey PRIMARY KEY (id)
);
