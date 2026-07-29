-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for brain_confidence_ledger.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f brain_confidence_ledger.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.brain_confidence_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  loop_id uuid NOT NULL,
  decision_intent_id uuid,
  raw_confidence numeric NOT NULL,
  post_simulation_confidence numeric NOT NULL,
  confidence_delta numeric NOT NULL,
  uncertainty_count integer NOT NULL DEFAULT 0,
  escalation_triggered boolean NOT NULL DEFAULT false,
  escalation_level text NOT NULL DEFAULT 'none'::text,
  notes text,
  CONSTRAINT brain_confidence_ledger_pkey PRIMARY KEY (id)
);
