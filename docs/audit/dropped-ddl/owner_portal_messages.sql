-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for owner_portal_messages.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f owner_portal_messages.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.owner_portal_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  meta_json jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT owner_portal_messages_pkey PRIMARY KEY (id),
  CONSTRAINT owner_portal_messages_role_check CHECK ((role = ANY (ARRAY['system'::text, 'assistant'::text, 'user'::text])))
);

CREATE INDEX idx_owner_portal_messages_thread_id ON public.owner_portal_messages USING btree (thread_id);
