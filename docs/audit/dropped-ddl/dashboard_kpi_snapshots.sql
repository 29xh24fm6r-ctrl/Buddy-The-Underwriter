-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for dashboard_kpi_snapshots.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f dashboard_kpi_snapshots.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.dashboard_kpi_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'global'::text,
  range_key text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  kpis jsonb NOT NULL,
  computed_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_kpi_snapshots_pkey PRIMARY KEY (id),
  CONSTRAINT dashboard_kpi_snapshots_scope_range_key_start_date_end_date_key UNIQUE (scope, range_key, start_date, end_date)
);
