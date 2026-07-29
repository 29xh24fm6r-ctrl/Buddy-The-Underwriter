-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for peis_anticipated_needs.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f peis_anticipated_needs.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.peis_anticipated_needs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  reason text NOT NULL,
  intelligence_type text NOT NULL,
  primary_subject text NOT NULL,
  urgency text NOT NULL DEFAULT 'today'::text,
  source_event_id text,
  source_deal_id text,
  source_commitment_id text,
  already_covered boolean NOT NULL DEFAULT false,
  coverage_mission_id uuid,
  fulfilled_at timestamp with time zone,
  target_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT peis_anticipated_needs_pkey PRIMARY KEY (id),
  CONSTRAINT peis_anticipated_needs_urgency_check CHECK ((urgency = ANY (ARRAY['immediate'::text, 'today'::text, 'this_week'::text])))
);

CREATE INDEX idx_peis_anticipated_needs_peis_anticipated_needs_coverage_miss ON public.peis_anticipated_needs USING btree (coverage_mission_id);
