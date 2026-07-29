-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for exec_outbox.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f exec_outbox.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.exec_outbox (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  job_kind text NOT NULL,
  payload_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'ready'::text,
  run_id uuid,
  idempotency_key text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  max_attempts integer NOT NULL DEFAULT 6,
  next_retry_at timestamp with time zone,
  locked_at timestamp with time zone,
  locked_by text,
  last_error_json jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT exec_outbox_idempotency_key_key UNIQUE (idempotency_key),
  CONSTRAINT exec_outbox_pkey PRIMARY KEY (id),
  CONSTRAINT exec_outbox_status_check CHECK ((status = ANY (ARRAY['ready'::text, 'running'::text, 'done'::text, 'dead'::text, 'retrying'::text])))
);

CREATE INDEX idx_exec_outbox_exec_outbox_run_id_fkey ON public.exec_outbox USING btree (run_id);
