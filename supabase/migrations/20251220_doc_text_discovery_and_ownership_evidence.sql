-- 20251220_doc_text_discovery_and_ownership_evidence.sql

-- ------------------------------------------------------------
-- A) Store "where OCR/text lives" once discovered (canonical mapping)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.doc_text_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,           -- e.g. "document_results"
  table_name text NOT NULL,            -- e.g. "document_results"
  deal_id_column text NULL,            -- e.g. "deal_id"
  document_id_column text NULL,        -- e.g. "document_id"
  label_column text NULL,              -- e.g. "doc_label" or "filename"
  text_column text NOT NULL,           -- e.g. "text" or "ocr_text"
  updated_at_column text NULL,         -- e.g. "updated_at"
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS doc_text_sources_active_idx
  ON public.doc_text_sources(is_active, created_at DESC);

ALTER TABLE public.doc_text_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS doc_text_sources_none ON public.doc_text_sources;
CREATE POLICY doc_text_sources_none ON public.doc_text_sources
FOR ALL USING (false) WITH CHECK (false);

-- ------------------------------------------------------------
-- B) Ownership findings upgrade: evidence offsets (for "live highlight")
-- (safe: offsets only, no extra sensitive data)
-- ------------------------------------------------------------
ALTER TABLE public.deal_ownership_findings
ADD COLUMN IF NOT EXISTS evidence_start int NULL,
ADD COLUMN IF NOT EXISTS evidence_end int NULL;

-- Keep RLS deny-all from earlier migration
