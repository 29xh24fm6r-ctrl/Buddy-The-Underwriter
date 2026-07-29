-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for capital_allocation_events.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f capital_allocation_events.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.capital_allocation_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bank_id uuid NOT NULL,
  deal_id uuid NOT NULL,
  decision_snapshot_id uuid NOT NULL,
  risk_weight numeric,
  exposure numeric,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT capital_allocation_events_pkey PRIMARY KEY (id)
);
