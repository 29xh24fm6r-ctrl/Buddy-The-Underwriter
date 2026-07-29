-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for deal_collateral_documents.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f deal_collateral_documents.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.deal_collateral_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  collateral_item_id uuid NOT NULL,
  document_id uuid NOT NULL,
  doc_purpose text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT deal_collateral_documents_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_deal_collateral_documents_deal_collateral_documents_deal_id ON public.deal_collateral_documents USING btree (deal_id);
