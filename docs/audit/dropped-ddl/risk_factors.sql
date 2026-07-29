-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for risk_factors.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f risk_factors.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.risk_factors (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  risk_run_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  label text NOT NULL,
  category text NOT NULL DEFAULT 'general'::text,
  direction text NOT NULL,
  contribution numeric NOT NULL DEFAULT 0,
  confidence numeric NOT NULL DEFAULT 0.75,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  rationale text NOT NULL DEFAULT ''::text,
  CONSTRAINT risk_factors_direction_check CHECK ((direction = ANY (ARRAY['positive'::text, 'negative'::text, 'neutral'::text]))),
  CONSTRAINT risk_factors_pkey PRIMARY KEY (id)
);

CREATE INDEX risk_factors_risk_run_id_idx ON public.risk_factors USING btree (risk_run_id);
