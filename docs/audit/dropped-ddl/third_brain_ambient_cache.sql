-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for third_brain_ambient_cache.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f third_brain_ambient_cache.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.third_brain_ambient_cache (
  user_id_uuid uuid NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + '00:30:00'::interval),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT third_brain_ambient_cache_pkey PRIMARY KEY (user_id_uuid)
);
