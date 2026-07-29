-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for banker_focus_sessions.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f banker_focus_sessions.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.banker_focus_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bank_id uuid NOT NULL,
  user_id text NOT NULL,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  ended_at timestamp with time zone,
  active_filter jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT banker_focus_sessions_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_banker_focus_sessions_user ON public.banker_focus_sessions USING btree (bank_id, user_id, started_at DESC);
