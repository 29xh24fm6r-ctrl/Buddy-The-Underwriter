-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for ledger_fiscal_periods.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f ledger_fiscal_periods.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.ledger_fiscal_periods (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'open'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ledger_fiscal_periods_pkey PRIMARY KEY (id),
  CONSTRAINT ledger_fiscal_periods_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text, 'locked'::text])))
);
