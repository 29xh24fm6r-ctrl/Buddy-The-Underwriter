-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for delivery_trackers.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f delivery_trackers.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.delivery_trackers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  provider text NOT NULL,
  external_tracking_id text NOT NULL,
  status text NOT NULL DEFAULT 'unknown'::text,
  last_checked_at timestamp with time zone,
  next_check_at timestamp with time zone,
  latest_json jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT delivery_trackers_pkey PRIMARY KEY (id)
);
