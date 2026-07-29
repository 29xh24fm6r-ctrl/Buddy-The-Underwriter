-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for brain_decision_intents.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f brain_decision_intents.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.brain_decision_intents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  loop_id uuid NOT NULL,
  intent jsonb NOT NULL,
  requires_confirmation boolean NOT NULL,
  confidence numeric NOT NULL,
  risk_level text NOT NULL DEFAULT 'low'::text,
  status text NOT NULL DEFAULT 'pending'::text,
  source_artifact_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  CONSTRAINT brain_decision_intents_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
  CONSTRAINT brain_decision_intents_pkey PRIMARY KEY (id),
  CONSTRAINT brain_decision_intents_risk_level_check CHECK ((risk_level = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
  CONSTRAINT brain_decision_intents_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'expired'::text])))
);
