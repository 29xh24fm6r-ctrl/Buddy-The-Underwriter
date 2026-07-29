-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for support_session_events.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f support_session_events.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.support_session_events (
  id bigint NOT NULL,
  session_id uuid NOT NULL,
  sequence integer NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT support_session_events_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_support_session_events_session_seq ON public.support_session_events USING btree (session_id, sequence);
