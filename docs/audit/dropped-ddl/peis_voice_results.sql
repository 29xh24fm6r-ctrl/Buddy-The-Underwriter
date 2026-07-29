-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for peis_voice_results.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f peis_voice_results.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.peis_voice_results (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_id text,
  artifact_id uuid,
  mission_id uuid,
  workflow_id text NOT NULL,
  voice_headline text NOT NULL,
  voice_summary text NOT NULL,
  voice_moves jsonb NOT NULL DEFAULT '[]'::jsonb,
  delivered boolean NOT NULL DEFAULT false,
  delivered_at timestamp with time zone,
  delivery_method text,
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + '00:10:00'::interval),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT peis_voice_results_pkey PRIMARY KEY (id)
);
