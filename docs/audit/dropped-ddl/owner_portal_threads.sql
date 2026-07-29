-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for owner_portal_threads.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f owner_portal_threads.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.owner_portal_threads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  owner_entity_id uuid NOT NULL,
  thread_key text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT owner_portal_threads_pkey PRIMARY KEY (id),
  CONSTRAINT owner_portal_threads_thread_key_key UNIQUE (thread_key)
);

CREATE INDEX idx_owner_portal_threads_owner_entity_id ON public.owner_portal_threads USING btree (owner_entity_id);
