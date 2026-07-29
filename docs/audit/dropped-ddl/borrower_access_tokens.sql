-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for borrower_access_tokens.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f borrower_access_tokens.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.borrower_access_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL,
  token text NOT NULL,
  expires_at timestamp with time zone,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT borrower_access_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT borrower_access_tokens_token_key UNIQUE (token)
);

CREATE INDEX borrower_access_tokens_app_idx ON public.borrower_access_tokens USING btree (application_id);
