-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for regulatory_sources.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f regulatory_sources.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.regulatory_sources (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_key text NOT NULL,
  name text NOT NULL,
  base_url text,
  fetch_strategy text NOT NULL DEFAULT 'MANUAL'::text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT regulatory_sources_fetch_strategy_check CHECK ((fetch_strategy = ANY (ARRAY['MANUAL'::text, 'SCHEDULED'::text, 'WEBHOOK'::text]))),
  CONSTRAINT regulatory_sources_pkey PRIMARY KEY (id),
  CONSTRAINT regulatory_sources_source_key_key UNIQUE (source_key)
);
