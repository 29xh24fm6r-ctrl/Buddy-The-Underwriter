-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for peis_advantage_briefs.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f peis_advantage_briefs.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.peis_advantage_briefs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  mission_id uuid,
  source_artifact_id uuid,
  brief_type text NOT NULL,
  headline text NOT NULL,
  why_now text NOT NULL,
  why_it_matters text NOT NULL,
  what_changed text,
  best_next_moves jsonb NOT NULL DEFAULT '[]'::jsonb,
  watchpoints jsonb NOT NULL DEFAULT '[]'::jsonb,
  open_unknowns jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence_summary text,
  delta_id uuid,
  materiality_tier text,
  delivered_to_voice boolean NOT NULL DEFAULT false,
  delivered_to_command_center boolean NOT NULL DEFAULT false,
  delivered_to_daily_sync boolean NOT NULL DEFAULT false,
  voice_delivered_at timestamp with time zone,
  tokens_used integer NOT NULL DEFAULT 0,
  cost_usd numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT peis_advantage_briefs_brief_type_check CHECK ((brief_type = ANY (ARRAY['pre_meeting'::text, 'delta_alert'::text, 'opportunity'::text, 'threat'::text, 'decision'::text, 'research'::text, 'monitoring'::text, 'trip'::text]))),
  CONSTRAINT peis_advantage_briefs_materiality_tier_check CHECK ((materiality_tier = ANY (ARRAY['none'::text, 'low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
  CONSTRAINT peis_advantage_briefs_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_briefs_mission ON public.peis_advantage_briefs USING btree (mission_id, created_at DESC);
CREATE INDEX idx_peis_advantage_briefs_peis_advantage_briefs_delta_id_fkey ON public.peis_advantage_briefs USING btree (delta_id);
