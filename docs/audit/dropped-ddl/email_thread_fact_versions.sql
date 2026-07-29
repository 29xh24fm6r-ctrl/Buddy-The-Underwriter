-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for email_thread_fact_versions.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f email_thread_fact_versions.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.email_thread_fact_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  thread_id text NOT NULL,
  version_number integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active'::text,
  supersedes_fact_version_id uuid,
  superseded_by_fact_version_id uuid,
  what_happened_json jsonb DEFAULT '[]'::jsonb,
  open_asks_json jsonb DEFAULT '[]'::jsonb,
  decisions_json jsonb DEFAULT '[]'::jsonb,
  blockers_json jsonb DEFAULT '[]'::jsonb,
  commitments_json jsonb DEFAULT '[]'::jsonb,
  deadlines_json jsonb DEFAULT '[]'::jsonb,
  waiting_on_json jsonb DEFAULT '[]'::jsonb,
  risks_json jsonb DEFAULT '[]'::jsonb,
  opportunities_json jsonb DEFAULT '[]'::jsonb,
  recommended_next_moves_json jsonb DEFAULT '[]'::jsonb,
  why_it_matters text,
  evidence_json jsonb DEFAULT '[]'::jsonb,
  confidence double precision DEFAULT 0.7,
  created_from_message_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT email_thread_fact_versions_pkey PRIMARY KEY (id),
  CONSTRAINT email_thread_fact_versions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'superseded'::text])))
);
