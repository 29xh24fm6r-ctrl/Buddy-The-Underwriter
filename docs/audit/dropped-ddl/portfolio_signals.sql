-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for portfolio_signals.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f portfolio_signals.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.portfolio_signals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bank_id uuid NOT NULL,
  signal_type text NOT NULL,
  severity text NOT NULL DEFAULT 'low'::text,
  relationship_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  explanation text NOT NULL,
  evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  detected_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT portfolio_signals_pkey PRIMARY KEY (id),
  CONSTRAINT portfolio_signals_severity_check CHECK ((severity = ANY (ARRAY['low'::text, 'moderate'::text, 'high'::text, 'critical'::text]))),
  CONSTRAINT portfolio_signals_type_check CHECK ((signal_type = ANY (ARRAY['deposit_runoff_cluster'::text, 'renewal_wave'::text, 'industry_stress_cluster'::text, 'treasury_stall_cluster'::text, 'growth_opportunity_cluster'::text])))
);

CREATE INDEX idx_portfolio_signals_bank ON public.portfolio_signals USING btree (bank_id, detected_at DESC);
