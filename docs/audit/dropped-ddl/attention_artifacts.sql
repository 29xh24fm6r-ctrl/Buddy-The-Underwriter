-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for attention_artifacts.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f attention_artifacts.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.attention_artifacts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  source text NOT NULL,
  artifact_type text NOT NULL,
  content text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT attention_artifacts_pkey PRIMARY KEY (id),
  CONSTRAINT attention_artifacts_source_check CHECK ((source = ANY (ARRAY['voice'::text, 'ui'::text, 'system'::text])))
);
