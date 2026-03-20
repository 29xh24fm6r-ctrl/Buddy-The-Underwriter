-- ============================================================
-- deal_extraction_runs — Replayable + Auditable Extraction Run Record
-- ============================================================
-- One run per (document_id, input_hash, engine_version) — idempotent.
-- If same input_hash+engine_version already succeeded → reuse results.
-- If stale running → mark failed + retry with new run.
--
-- Invariant: NO facts may be persisted without a corresponding
-- extraction run record in status='succeeded'.

CREATE TABLE IF NOT EXISTS deal_extraction_runs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id                  UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  document_id              UUID NOT NULL,
  artifact_id              UUID,

  -- Engine versioning
  engine_version           TEXT NOT NULL,             -- e.g. "hybrid_v1.0"
  ocr_engine               TEXT NOT NULL,             -- "gemini_ocr"
  structured_engine        TEXT,                      -- "gemini_flash" | null
  structured_model         TEXT,                      -- "gemini-2.0-flash" | null
  prompt_version           TEXT,                      -- "flash_prompts_v1" | null
  structured_schema_version TEXT,                     -- "structured_v1" | null

  -- Dedup + replay
  input_hash               TEXT NOT NULL,             -- sha256(ocrTextNormalized + canonicalType + yearHint + promptVersion)
  output_hash              TEXT,                      -- sha256(normalizedStructuredJson) | null

  -- Status
  status                   TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'routed_to_review')),
  failure_code             TEXT,                      -- standardized code (see A2)
  failure_detail           JSONB,

  -- Cost + latency
  metrics                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Expected shape: { latency_ms, cost_estimate_usd, ocr_latency_ms, structured_latency_ms,
  --                    pages, tokens_in, tokens_out, retry_count }

  -- Timestamps
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at             TIMESTAMPTZ,

  -- Idempotency constraint: one run per (document, input, engine)
  CONSTRAINT uq_extraction_run_dedup UNIQUE (document_id, input_hash, engine_version)
);

-- Index for fast lookup by deal
CREATE INDEX IF NOT EXISTS idx_extraction_runs_deal_id
  ON deal_extraction_runs(deal_id);

-- Index for fast lookup by document
CREATE INDEX IF NOT EXISTS idx_extraction_runs_document_id
  ON deal_extraction_runs(document_id);

-- Index for stale-run detection (running + old created_at)
CREATE INDEX IF NOT EXISTS idx_extraction_runs_stale
  ON deal_extraction_runs(status, created_at)
  WHERE status = 'running';

-- Enable RLS (service-role only — no browser access)
ALTER TABLE deal_extraction_runs ENABLE ROW LEVEL SECURITY;
