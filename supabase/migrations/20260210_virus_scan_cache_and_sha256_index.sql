-- =====================================================
-- Virus scan cache + SHA-256 indexes for content dedup
-- =====================================================

BEGIN;

-- 1. virus_scan_cache: cross-deal scan deduplication per bank tenant
CREATE TABLE IF NOT EXISTS public.virus_scan_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id UUID NOT NULL,
  content_sha256 TEXT NOT NULL,
  scan_status TEXT NOT NULL DEFAULT 'clean'
    CHECK (scan_status IN ('clean', 'infected', 'scan_failed')),
  scan_engine TEXT,
  virus_signature TEXT,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bank_id, content_sha256)
);

ALTER TABLE public.virus_scan_cache ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.virus_scan_cache IS
  'Cross-deal virus scan cache. Keyed by (bank_id, content_sha256) for tenant-isolated deduplication.';
COMMENT ON COLUMN public.virus_scan_cache.content_sha256 IS
  'SHA-256 hex digest of file content bytes';

-- 2. Indexes for SHA-256 lookups on deal_documents (OCR + extract dedup)
CREATE INDEX IF NOT EXISTS idx_deal_documents_sha256
  ON public.deal_documents (sha256)
  WHERE sha256 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deal_documents_bank_sha256
  ON public.deal_documents (bank_id, sha256)
  WHERE sha256 IS NOT NULL;

COMMIT;
