-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for email_operator_repairs.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f email_operator_repairs.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.email_operator_repairs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  thread_id text,
  message_id text,
  attachment_id text,
  repair_type text NOT NULL,
  requested_by text NOT NULL,
  reason text,
  status text DEFAULT 'started'::text,
  job_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  CONSTRAINT email_operator_repairs_pkey PRIMARY KEY (id),
  CONSTRAINT email_operator_repairs_status_check CHECK ((status = ANY (ARRAY['started'::text, 'completed'::text, 'failed'::text])))
);
