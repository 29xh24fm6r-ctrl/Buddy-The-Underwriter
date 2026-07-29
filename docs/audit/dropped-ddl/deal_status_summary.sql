-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for deal_status_summary.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f deal_status_summary.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.deal_status_summary (
  deal_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'intake'::text,
  banker_eta_days integer,
  banker_note text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT deal_status_summary_pkey PRIMARY KEY (deal_id)
);
