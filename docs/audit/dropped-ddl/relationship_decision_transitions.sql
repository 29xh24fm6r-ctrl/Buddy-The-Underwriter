-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for relationship_decision_transitions.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f relationship_decision_transitions.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.relationship_decision_transitions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  relationship_id uuid NOT NULL,
  bank_id uuid NOT NULL,
  previous_tier text,
  new_tier text NOT NULL,
  previous_action_code text,
  new_action_code text,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  envelope_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  transitioned_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT rel_decision_transitions_tier_check CHECK ((new_tier = ANY (ARRAY['integrity'::text, 'critical_distress'::text, 'time_bound_work'::text, 'borrower_blocked'::text, 'protection'::text, 'growth'::text, 'informational'::text]))),
  CONSTRAINT relationship_decision_transitions_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_relationship_decision_transitions_relationship_decision_tra ON public.relationship_decision_transitions USING btree (bank_id);
