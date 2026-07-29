-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for financial_exception_instances.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f financial_exception_instances.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.financial_exception_instances (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  snapshot_id uuid,
  source_kind text NOT NULL,
  exception_kind text NOT NULL,
  category text NOT NULL,
  severity text NOT NULL,
  decision_impact text NOT NULL,
  status text NOT NULL DEFAULT 'open'::text,
  fact_key text,
  period_key text,
  title text NOT NULL,
  summary text NOT NULL,
  why_it_matters text NOT NULL,
  recommended_action text,
  committee_disclosure text,
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT financial_exception_instances_pkey PRIMARY KEY (id),
  CONSTRAINT financial_exception_instances_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'low'::text, 'moderate'::text, 'high'::text, 'critical'::text]))),
  CONSTRAINT financial_exception_instances_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text, 'deferred'::text])))
);

CREATE INDEX idx_fei_deal_id ON public.financial_exception_instances USING btree (deal_id);
