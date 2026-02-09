-- =====================================================
-- Extraction cache: reuse OCR/DocAI results for identical file bytes
-- Keyed by (bank_id, content_sha256, engine, engine_version)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.doc_extraction_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id UUID NOT NULL,
  content_sha256 TEXT NOT NULL,
  engine TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bank_id, content_sha256, engine, engine_version)
);

CREATE INDEX IF NOT EXISTS idx_doc_extraction_cache_lookup
  ON public.doc_extraction_cache (bank_id, content_sha256, engine, engine_version);

ALTER TABLE public.doc_extraction_cache ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.doc_extraction_cache IS
  'Engine-versioned extraction cache. Reuse OCR/DocAI results for identical file bytes within a bank.';
COMMENT ON COLUMN public.doc_extraction_cache.engine IS
  'Extraction engine identifier: GEMINI_OCR, DOCAI, GEMINI_EXTRACT';
COMMENT ON COLUMN public.doc_extraction_cache.engine_version IS
  'Bump when prompts/parsers change to invalidate stale cache entries';
COMMENT ON COLUMN public.doc_extraction_cache.payload IS
  'Cached extraction outputs (text, tables, fields, evidence, etc.)';
