-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for workflow_runs.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f workflow_runs.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.workflow_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  parent_run_id uuid,
  status text NOT NULL,
  current_step_index integer NOT NULL DEFAULT 0,
  plan_json jsonb NOT NULL,
  context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_json jsonb,
  locked_at timestamp with time zone,
  locked_by text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT workflow_runs_pkey PRIMARY KEY (id),
  CONSTRAINT workflow_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'paused'::text, 'waiting'::text, 'succeeded'::text, 'failed'::text, 'canceled'::text])))
);

CREATE INDEX idx_workflow_runs_workflow_runs_parent_run_id_fkey ON public.workflow_runs USING btree (parent_run_id);
