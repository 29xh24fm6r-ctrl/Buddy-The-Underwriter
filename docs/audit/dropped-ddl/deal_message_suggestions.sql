-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for deal_message_suggestions.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f deal_message_suggestions.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.deal_message_suggestions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  suggested_body text NOT NULL,
  reason text,
  confidence numeric(5,2),
  evidence_json jsonb,
  status text NOT NULL DEFAULT 'suggested'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT deal_message_suggestions_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (100)::numeric))),
  CONSTRAINT deal_message_suggestions_pkey PRIMARY KEY (id)
);
