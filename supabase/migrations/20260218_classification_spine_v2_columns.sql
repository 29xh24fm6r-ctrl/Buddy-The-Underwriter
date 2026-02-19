-- Classification Spine v2 — add traceability columns to deal_documents
-- Two nullable TEXT columns. No data migration needed.

ALTER TABLE deal_documents
  ADD COLUMN IF NOT EXISTS classification_version TEXT,
  ADD COLUMN IF NOT EXISTS classification_tier TEXT;

CREATE INDEX IF NOT EXISTS idx_deal_documents_classification_tier
  ON deal_documents(classification_tier, classification_version)
  WHERE classification_tier IS NOT NULL;
