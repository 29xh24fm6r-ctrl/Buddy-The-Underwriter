-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for autonomy_scores.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f autonomy_scores.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.autonomy_scores (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  intent_type text NOT NULL,
  confidence_score double precision NOT NULL DEFAULT 0.0,
  approval_count integer NOT NULL DEFAULT 0,
  rejection_count integer NOT NULL DEFAULT 0,
  autonomy_level text NOT NULL DEFAULT 'l0'::text,
  last_action_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT autonomy_scores_autonomy_level_check CHECK ((autonomy_level = ANY (ARRAY['none'::text, 'l0'::text, 'l1'::text]))),
  CONSTRAINT autonomy_scores_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX autonomy_scores_idx ON public.autonomy_scores USING btree (owner_user_id, intent_type);
