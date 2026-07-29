-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for aegis_recording_sessions.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f aegis_recording_sessions.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.aegis_recording_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  user_id text NOT NULL,
  bank_id uuid NOT NULL,
  deal_id uuid,
  status text NOT NULL DEFAULT 'active'::text,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  stopped_at timestamp with time zone,
  frame_count integer NOT NULL DEFAULT 0,
  finding_count integer NOT NULL DEFAULT 0,
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT aegis_recording_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT aegis_recording_sessions_session_id_key UNIQUE (session_id),
  CONSTRAINT aegis_recording_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'stopped'::text, 'exported'::text, 'analyzed'::text])))
);
