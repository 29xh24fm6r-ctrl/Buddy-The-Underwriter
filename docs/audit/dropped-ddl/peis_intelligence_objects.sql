-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for peis_intelligence_objects.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f peis_intelligence_objects.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.peis_intelligence_objects (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  object_type text NOT NULL,
  canonical_name text NOT NULL,
  status text NOT NULL DEFAULT 'active'::text,
  origin_mission_id uuid,
  entity_keys jsonb NOT NULL DEFAULT '{}'::jsonb,
  world_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  open_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  opportunity_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  watch_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  relationship_to_user jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_material_change_at timestamp with time zone,
  next_review_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT peis_intelligence_objects_object_type_check CHECK ((object_type = ANY (ARRAY['person'::text, 'company'::text, 'place'::text, 'event'::text, 'decision'::text, 'opportunity'::text, 'threat'::text, 'topic'::text]))),
  CONSTRAINT peis_intelligence_objects_pkey PRIMARY KEY (id),
  CONSTRAINT peis_intelligence_objects_status_check CHECK ((status = ANY (ARRAY['active'::text, 'stale'::text, 'archived'::text])))
);

CREATE UNIQUE INDEX idx_objects_user_type_name ON public.peis_intelligence_objects USING btree (user_id, object_type, canonical_name);
CREATE INDEX idx_peis_intelligence_objects_peis_intelligence_objects_origin_ ON public.peis_intelligence_objects USING btree (origin_mission_id);
