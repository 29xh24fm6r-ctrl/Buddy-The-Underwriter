-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for deal_entity_relationships.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f deal_entity_relationships.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.deal_entity_relationships (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  parent_entity_id uuid NOT NULL,
  child_entity_id uuid NOT NULL,
  relationship_type text NOT NULL,
  ownership_pct numeric(5,2),
  control_type text,
  consolidation_required boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT deal_entity_relationships_control_type_check CHECK (((control_type IS NULL) OR (control_type = ANY (ARRAY['majority'::text, 'minority'::text, 'common_control'::text, 'affiliated'::text])))),
  CONSTRAINT deal_entity_relationships_deal_id_parent_entity_id_child_en_key UNIQUE (deal_id, parent_entity_id, child_entity_id, relationship_type),
  CONSTRAINT deal_entity_relationships_pkey PRIMARY KEY (id),
  CONSTRAINT deal_entity_relationships_relationship_type_check CHECK ((relationship_type = ANY (ARRAY['parent_subsidiary'::text, 'common_control'::text, 'affiliated'::text, 'guarantor_relationship'::text])))
);

CREATE INDEX idx_entity_relationships_deal ON public.deal_entity_relationships USING btree (deal_id);
CREATE INDEX idx_deal_entity_relationships_deal_entity_relationships_parent_ ON public.deal_entity_relationships USING btree (parent_entity_id);
CREATE INDEX idx_deal_entity_relationships_deal_entity_relationships_child_e ON public.deal_entity_relationships USING btree (child_entity_id);
