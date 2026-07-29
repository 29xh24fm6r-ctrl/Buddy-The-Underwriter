-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for bank_asset_text.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f bank_asset_text.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.bank_asset_text (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL,
  bank_id uuid NOT NULL,
  chunk_index integer NOT NULL DEFAULT 0,
  content text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT bank_asset_text_pkey PRIMARY KEY (id)
);

CREATE INDEX bank_asset_text_asset_idx ON public.bank_asset_text USING btree (asset_id, chunk_index);
CREATE INDEX bank_asset_text_bank_idx ON public.bank_asset_text USING btree (bank_id, created_at DESC);
