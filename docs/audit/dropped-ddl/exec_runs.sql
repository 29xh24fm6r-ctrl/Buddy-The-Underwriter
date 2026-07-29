-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for exec_runs.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f exec_runs.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.exec_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  parent_run_id uuid,
  run_kind text NOT NULL,
  status text NOT NULL DEFAULT 'queued'::text,
  request_json jsonb NOT NULL,
  result_json jsonb,
  error_json jsonb,
  idempotency_key text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  max_attempts integer NOT NULL DEFAULT 3,
  next_retry_at timestamp with time zone,
  locked_at timestamp with time zone,
  locked_by text,
  trace_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT exec_runs_pkey PRIMARY KEY (id),
  CONSTRAINT exec_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'canceled'::text, 'retrying'::text])))
);

CREATE UNIQUE INDEX exec_runs_idempotency_idx ON public.exec_runs USING btree (owner_user_id, idempotency_key);
CREATE INDEX idx_exec_runs_exec_runs_parent_run_id_fkey ON public.exec_runs USING btree (parent_run_id);
