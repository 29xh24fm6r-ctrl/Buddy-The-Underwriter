-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for peis_routing_preferences.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f peis_routing_preferences.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.peis_routing_preferences (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  adjudicated_by text NOT NULL DEFAULT 'omega_prime'::text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT peis_routing_preferences_pkey PRIMARY KEY (id),
  CONSTRAINT peis_routing_preferences_user_id_key UNIQUE (user_id)
);
