-- Matching Engine v1 — Evidence + Version columns on deal_documents
-- Stores structured match evidence (JSONB) and engine version for audit replay.

ALTER TABLE deal_documents
  ADD COLUMN IF NOT EXISTS match_evidence JSONB,
  ADD COLUMN IF NOT EXISTS matching_engine_version TEXT;

CREATE INDEX IF NOT EXISTS idx_deal_documents_matching_version
  ON deal_documents(matching_engine_version)
  WHERE matching_engine_version IS NOT NULL;
