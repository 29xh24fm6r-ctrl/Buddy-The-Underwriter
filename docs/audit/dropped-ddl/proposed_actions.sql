-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for proposed_actions.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f proposed_actions.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.proposed_actions (
  id text NOT NULL,
  user_id uuid NOT NULL,
  title text NOT NULL,
  reasoning text,
  type text NOT NULL,
  payload jsonb,
  confidence numeric,
  status text DEFAULT 'pending'::text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT proposed_actions_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_proposed_actions_proposed_actions_user_id_fkey ON public.proposed_actions USING btree (user_id);
