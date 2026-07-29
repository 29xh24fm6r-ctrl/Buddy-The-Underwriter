-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for franchise_brand_aliases.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f franchise_brand_aliases.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.franchise_brand_aliases (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL,
  alias_name text NOT NULL,
  source text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT franchise_brand_aliases_alias_name_source_key UNIQUE (alias_name, source),
  CONSTRAINT franchise_brand_aliases_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_franchise_aliases_brand ON public.franchise_brand_aliases USING btree (brand_id);
