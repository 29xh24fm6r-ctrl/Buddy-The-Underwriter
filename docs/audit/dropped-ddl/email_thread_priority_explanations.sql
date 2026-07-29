-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for email_thread_priority_explanations.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f email_thread_priority_explanations.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.email_thread_priority_explanations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  thread_id text NOT NULL,
  user_id text NOT NULL,
  total_score double precision NOT NULL,
  recommended_surface text,
  expires_at timestamp with time zone,
  components_json jsonb DEFAULT '[]'::jsonb,
  surfaced_because_json jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT email_thread_priority_explanations_pkey PRIMARY KEY (id)
);
