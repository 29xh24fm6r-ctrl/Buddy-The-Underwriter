-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for sba_servicing_events.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f sba_servicing_events.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.sba_servicing_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sba_loan_id uuid NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamp with time zone NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL DEFAULT 'system'::text,
  CONSTRAINT sba_servicing_events_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_sba_events_loan ON public.sba_servicing_events USING btree (sba_loan_id, occurred_at DESC);
