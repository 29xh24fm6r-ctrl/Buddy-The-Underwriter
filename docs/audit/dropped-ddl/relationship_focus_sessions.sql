-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for relationship_focus_sessions.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f relationship_focus_sessions.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.relationship_focus_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  relationship_id uuid NOT NULL,
  bank_id uuid NOT NULL,
  user_id uuid NOT NULL,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  ended_at timestamp with time zone,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT relationship_focus_sessions_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_relationship_focus_sessions_relationship_focus_sessions_ban ON public.relationship_focus_sessions USING btree (bank_id);
