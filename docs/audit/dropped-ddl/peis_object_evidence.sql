-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for peis_object_evidence.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f peis_object_evidence.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.peis_object_evidence (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  object_id uuid NOT NULL,
  mission_id uuid,
  artifact_id uuid,
  source_type text NOT NULL,
  source_url text,
  source_title text,
  content_hash text,
  evidence_summary text NOT NULL,
  structured_extract jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric,
  is_delta boolean NOT NULL DEFAULT false,
  observed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT peis_object_evidence_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_evidence_object ON public.peis_object_evidence USING btree (object_id, created_at DESC);
CREATE INDEX idx_evidence_mission ON public.peis_object_evidence USING btree (mission_id) WHERE (mission_id IS NOT NULL);
CREATE INDEX idx_evidence_hash ON public.peis_object_evidence USING btree (object_id, content_hash) WHERE (content_hash IS NOT NULL);
