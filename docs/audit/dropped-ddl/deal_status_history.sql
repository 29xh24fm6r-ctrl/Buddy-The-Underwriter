-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for deal_status_history.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f deal_status_history.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.deal_status_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  changed_by_user_id uuid,
  from_stage text,
  to_stage text NOT NULL,
  note text,
  meta_json jsonb,
  changed_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT deal_status_history_pkey PRIMARY KEY (id)
);
