-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for deal_policy_deviations.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f deal_policy_deviations.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.deal_policy_deviations (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  deal_id uuid NOT NULL,
  field_name text NOT NULL,
  field_label text NOT NULL,
  policy_default text NOT NULL,
  actual_value text NOT NULL,
  justification text,
  created_at timestamp with time zone DEFAULT now(),
  created_by text,
  CONSTRAINT deal_policy_deviations_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_deal_deviations_deal ON public.deal_policy_deviations USING btree (deal_id);
