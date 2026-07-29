-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for bank_credit_policies.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f bank_credit_policies.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.bank_credit_policies (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bank_id uuid NOT NULL,
  name text NOT NULL,
  version text NOT NULL DEFAULT 'v1'::text,
  file_path text NOT NULL,
  mime_type text NOT NULL,
  extracted_text text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT bank_credit_policies_bank_id_version_key UNIQUE (bank_id, version),
  CONSTRAINT bank_credit_policies_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_policies_bank_active ON public.bank_credit_policies USING btree (bank_id, is_active);
