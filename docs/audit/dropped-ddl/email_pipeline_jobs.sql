-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for email_pipeline_jobs.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f email_pipeline_jobs.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.email_pipeline_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  thread_id text NOT NULL,
  message_id text,
  stage text NOT NULL,
  status text NOT NULL DEFAULT 'queued'::text,
  attempt_count integer DEFAULT 0,
  max_attempts integer DEFAULT 3,
  causal_parent_job_id uuid,
  dedupe_key text NOT NULL,
  payload_json jsonb DEFAULT '{}'::jsonb,
  error_code text,
  error_message text,
  next_retry_at timestamp with time zone,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  dead_lettered_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT email_pipeline_jobs_pkey PRIMARY KEY (id),
  CONSTRAINT email_pipeline_jobs_stage_check CHECK ((stage = ANY (ARRAY['membrane_ingest'::text, 'body_extract'::text, 'attachment_extract'::text, 'sender_resolve'::text, 'intent_build'::text, 'lifecycle_refresh'::text, 'priority_refresh'::text, 'brief_refresh'::text, 'convergence_refresh'::text, 'command_refresh'::text]))),
  CONSTRAINT email_pipeline_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'failed_retryable'::text, 'failed_terminal'::text, 'dead_lettered'::text, 'cancelled'::text])))
);
