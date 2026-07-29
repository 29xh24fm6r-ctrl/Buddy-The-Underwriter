-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for buddy_tuning_decisions.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f buddy_tuning_decisions.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.buddy_tuning_decisions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL,
  decision text NOT NULL,
  decision_reason text,
  approved_by text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT buddy_tuning_decisions_decision_check CHECK ((decision = ANY (ARRAY['approve'::text, 'reject'::text, 'defer'::text, 'rollback'::text]))),
  CONSTRAINT buddy_tuning_decisions_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_tuning_decisions_candidate ON public.buddy_tuning_decisions USING btree (candidate_id);
