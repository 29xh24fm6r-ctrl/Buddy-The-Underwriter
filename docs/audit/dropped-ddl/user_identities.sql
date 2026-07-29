-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for user_identities.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f user_identities.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.user_identities (
  user_id uuid NOT NULL,
  clerk_user_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_identities_clerk_user_id_key UNIQUE (clerk_user_id),
  CONSTRAINT user_identities_pkey PRIMARY KEY (user_id)
);
