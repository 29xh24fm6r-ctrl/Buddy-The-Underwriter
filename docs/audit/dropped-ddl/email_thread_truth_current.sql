-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for email_thread_truth_current.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f email_thread_truth_current.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.email_thread_truth_current (
  thread_id text NOT NULL,
  current_fact_version_id uuid,
  last_truth_refresh_at timestamp with time zone,
  last_supersession_at timestamp with time zone,
  CONSTRAINT email_thread_truth_current_pkey PRIMARY KEY (thread_id)
);

CREATE INDEX idx_email_thread_truth_current_email_thread_truth_current_curre ON public.email_thread_truth_current USING btree (current_fact_version_id);
