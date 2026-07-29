-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for borrower_automation_state.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f borrower_automation_state.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.borrower_automation_state (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  condition_id uuid,
  last_borrower_activity_at timestamp with time zone,
  last_nudge_at timestamp with time zone,
  stall_detected_at timestamp with time zone,
  stall_reason text,
  status text NOT NULL DEFAULT 'ACTIVE'::text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT borrower_automation_state_deal_id_condition_id_key UNIQUE (deal_id, condition_id),
  CONSTRAINT borrower_automation_state_pkey PRIMARY KEY (id),
  CONSTRAINT borrower_automation_state_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'PAUSED'::text])))
);
