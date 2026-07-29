-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for ai_run_events.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f ai_run_events.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.ai_run_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  deal_id uuid,
  bank_id uuid,
  run_kind text NOT NULL,
  model text,
  input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  usage_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ai_run_events_pkey PRIMARY KEY (id)
);
