-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for skill_evolution_proposals.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f skill_evolution_proposals.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.skill_evolution_proposals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  skill_id text NOT NULL,
  user_id text NOT NULL,
  proposed_context_block text NOT NULL,
  rationale text NOT NULL,
  failure_log_ids uuid[] NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  reviewed_at timestamp with time zone,
  applied_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT skill_evolution_proposals_pkey PRIMARY KEY (id),
  CONSTRAINT skill_evolution_proposals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'applied'::text])))
);

CREATE INDEX idx_evo_proposals_skill ON public.skill_evolution_proposals USING btree (skill_id, status);
