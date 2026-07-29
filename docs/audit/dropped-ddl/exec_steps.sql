-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for exec_steps.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f exec_steps.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.exec_steps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  event_name text NOT NULL,
  detail_json jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT exec_steps_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_exec_steps_exec_steps_run_id_fkey ON public.exec_steps USING btree (run_id);
