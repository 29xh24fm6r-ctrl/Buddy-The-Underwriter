-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for buddy_research_blocked_sources.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f buddy_research_blocked_sources.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.buddy_research_blocked_sources (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  url text NOT NULL,
  domain text NOT NULL,
  reason text NOT NULL,
  mission_id uuid,
  deal_id uuid,
  CONSTRAINT buddy_research_blocked_sources_pkey PRIMARY KEY (id)
);
