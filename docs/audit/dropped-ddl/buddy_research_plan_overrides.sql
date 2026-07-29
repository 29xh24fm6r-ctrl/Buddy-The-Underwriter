-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for buddy_research_plan_overrides.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f buddy_research_plan_overrides.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.buddy_research_plan_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  deal_id uuid NOT NULL,
  plan_id text NOT NULL,
  action text NOT NULL,
  mission_type text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_id uuid NOT NULL,
  reason text,
  CONSTRAINT buddy_research_plan_overrides_action_check CHECK ((action = ANY (ARRAY['approve'::text, 'reject'::text, 'disable_mission'::text, 'enable_mission'::text, 'reorder'::text, 'force_rerun'::text]))),
  CONSTRAINT buddy_research_plan_overrides_pkey PRIMARY KEY (id)
);
