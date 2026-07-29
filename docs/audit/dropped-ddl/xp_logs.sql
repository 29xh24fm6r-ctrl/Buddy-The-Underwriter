-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for xp_logs.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f xp_logs.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.xp_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  amount integer NOT NULL DEFAULT 0,
  category text NOT NULL,
  activity text NOT NULL,
  source_type text,
  source_id text,
  notes text,
  was_crit boolean DEFAULT false,
  base_amount integer,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT xp_logs_pkey PRIMARY KEY (id)
);
