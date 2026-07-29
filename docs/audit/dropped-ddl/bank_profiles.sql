-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for bank_profiles.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f bank_profiles.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.bank_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT bank_profiles_pkey PRIMARY KEY (id),
  CONSTRAINT bank_profiles_slug_key UNIQUE (slug)
);
