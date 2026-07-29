-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for buddy_research_autonomy_settings.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f buddy_research_autonomy_settings.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.buddy_research_autonomy_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  bank_id uuid,
  deal_id uuid,
  autonomy_level text NOT NULL DEFAULT 'RECOMMEND'::text,
  set_by_user_id uuid,
  previous_level text,
  reason text,
  CONSTRAINT buddy_research_autonomy_settings_autonomy_level_check CHECK ((autonomy_level = ANY (ARRAY['OFF'::text, 'RECOMMEND'::text, 'AUTO_RUN'::text]))),
  CONSTRAINT buddy_research_autonomy_settings_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX buddy_research_autonomy_settings_deal_idx ON public.buddy_research_autonomy_settings USING btree (deal_id) WHERE (deal_id IS NOT NULL);
CREATE UNIQUE INDEX buddy_research_autonomy_settings_bank_idx ON public.buddy_research_autonomy_settings USING btree (bank_id) WHERE ((bank_id IS NOT NULL) AND (deal_id IS NULL));
