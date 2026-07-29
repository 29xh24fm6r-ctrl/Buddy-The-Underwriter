-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for email_command_home_cache.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f email_command_home_cache.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.email_command_home_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id_uuid uuid NOT NULL,
  command_home_view jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamp with time zone NOT NULL DEFAULT now(),
  thread_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT email_command_home_cache_pkey PRIMARY KEY (id),
  CONSTRAINT email_command_home_cache_user_id_uuid_key UNIQUE (user_id_uuid)
);

CREATE INDEX idx_email_command_home_cache_user ON public.email_command_home_cache USING btree (user_id_uuid);
