-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for peis_mission_objects.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f peis_mission_objects.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.peis_mission_objects (
  mission_id uuid NOT NULL,
  object_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'primary'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT peis_mission_objects_pkey PRIMARY KEY (mission_id, object_id)
);

CREATE INDEX idx_mission_objects_object ON public.peis_mission_objects USING btree (object_id);
