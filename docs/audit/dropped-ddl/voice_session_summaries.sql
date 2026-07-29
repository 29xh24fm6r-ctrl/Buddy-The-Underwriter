-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for voice_session_summaries.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f voice_session_summaries.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.voice_session_summaries (
  session_id text NOT NULL,
  user_id text NOT NULL,
  summary_text text NOT NULL,
  detected_commitments jsonb NOT NULL DEFAULT '[]'::jsonb,
  emotional_tone text,
  key_topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  turn_count integer NOT NULL DEFAULT 0,
  snapshot_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT voice_session_summaries_pkey PRIMARY KEY (session_id)
);
