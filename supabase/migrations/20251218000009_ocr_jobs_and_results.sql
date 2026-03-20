-- Durable Job System for OCR + Classification
-- Replaces /tmp fragility with Postgres-backed queue

BEGIN;

-- Job queue for OCR + classification (durable)
CREATE TABLE IF NOT EXISTS public.document_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL,
  attachment_id UUID NOT NULL, -- references borrower_attachments.id (no FK required)
  job_type TEXT NOT NULL CHECK (job_type IN ('OCR','CLASSIFY')),
  status TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
  attempt INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  leased_until TIMESTAMPTZ NULL,
  lease_owner TEXT NULL,
  error TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (attachment_id, job_type)  -- idempotency at DB-level
);

CREATE INDEX IF NOT EXISTS idx_doc_jobs_next
  ON public.document_jobs(status, next_run_at);

CREATE INDEX IF NOT EXISTS idx_doc_jobs_deal
  ON public.document_jobs(deal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_doc_jobs_lease
  ON public.document_jobs(leased_until) WHERE status = 'RUNNING';

COMMENT ON TABLE public.document_jobs IS 'Durable job queue for document processing (OCR + classification)';
COMMENT ON COLUMN public.document_jobs.leased_until IS 'Lease expiration for worker coordination (prevents duplicate processing)';
COMMENT ON COLUMN public.document_jobs.lease_owner IS 'Worker identifier (hostname + PID)';
COMMENT ON COLUMN public.document_jobs.next_run_at IS 'When job should run next (for retries with backoff)';

-- OCR results (durable)
CREATE TABLE IF NOT EXISTS public.document_ocr_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL,
  attachment_id UUID NOT NULL,
  provider TEXT NOT NULL DEFAULT 'azure_di',
  status TEXT NOT NULL DEFAULT 'SUCCEEDED'
    CHECK (status IN ('SUCCEEDED','FAILED')),
  raw_json JSONB NULL,
  extracted_text TEXT NULL,
  tables_json JSONB NULL,
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (attachment_id)
);

CREATE INDEX IF NOT EXISTS idx_ocr_results_deal
  ON public.document_ocr_results(deal_id, created_at DESC);

COMMENT ON TABLE public.document_ocr_results IS 'Permanent OCR results storage (no re-processing needed)';
COMMENT ON COLUMN public.document_ocr_results.raw_json IS 'Full Azure DI response (for audit/debugging)';
COMMENT ON COLUMN public.document_ocr_results.extracted_text IS 'Plain text extraction for classification';

-- Classification results (durable)
CREATE TABLE IF NOT EXISTS public.document_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL,
  attachment_id UUID NOT NULL,
  doc_type TEXT NULL,
  confidence NUMERIC NULL,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (attachment_id)
);

CREATE INDEX IF NOT EXISTS idx_doc_class_deal
  ON public.document_classifications(deal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_doc_class_type
  ON public.document_classifications(doc_type);

COMMENT ON TABLE public.document_classifications IS 'Document type classifications (deterministic + explainable)';
COMMENT ON COLUMN public.document_classifications.reasons IS 'Explanation array for classification decision';

COMMIT;
