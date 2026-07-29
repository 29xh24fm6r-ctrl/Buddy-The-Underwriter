-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for peis_signal_mesh.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f peis_signal_mesh.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.peis_signal_mesh (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  object_id uuid,
  signal_type text NOT NULL,
  signal_content text NOT NULL,
  signal_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  significance text NOT NULL DEFAULT 'low'::text,
  is_synthesized boolean NOT NULL DEFAULT false,
  synthesis_id uuid,
  observed_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT peis_signal_mesh_pkey PRIMARY KEY (id),
  CONSTRAINT peis_signal_mesh_signal_type_check CHECK ((signal_type = ANY (ARRAY['calendar_mention'::text, 'voice_mention'::text, 'email_mention'::text, 'news_alert'::text, 'sec_filing'::text, 'linkedin_change'::text, 'job_posting'::text, 'monitoring_delta'::text, 'deal_signal'::text, 'commitment_signal'::text, 'ledger_signal'::text, 'manual'::text]))),
  CONSTRAINT peis_signal_mesh_significance_check CHECK ((significance = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])))
);

CREATE INDEX idx_mesh_object ON public.peis_signal_mesh USING btree (object_id, is_synthesized);
