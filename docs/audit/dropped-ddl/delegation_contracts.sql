-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for delegation_contracts.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f delegation_contracts.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.delegation_contracts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  intent_type text NOT NULL,
  workflow_template_id text NOT NULL,
  constraints_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  max_executions integer DEFAULT 0,
  current_executions integer DEFAULT 0,
  expires_at timestamp with time zone,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT delegation_contracts_pkey PRIMARY KEY (id)
);

CREATE INDEX delegation_contracts_lookup_idx ON public.delegation_contracts USING btree (owner_user_id, intent_type, workflow_template_id) WHERE (revoked_at IS NULL);
