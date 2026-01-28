-- Add canonical classification columns to deal_documents.
-- These are stamped by the artifact processor (processArtifact.ts) after AI classification.
-- deal_documents is the ONLY canonical document record.

ALTER TABLE deal_documents
ADD COLUMN IF NOT EXISTS source TEXT,
ADD COLUMN IF NOT EXISTS document_type TEXT,
ADD COLUMN IF NOT EXISTS doc_year INTEGER,
ADD COLUMN IF NOT EXISTS doc_years INTEGER[],
ADD COLUMN IF NOT EXISTS classification_confidence NUMERIC,
ADD COLUMN IF NOT EXISTS classification_reason TEXT,
ADD COLUMN IF NOT EXISTS entity_name TEXT;

-- Constrain source to known upload origins
DO $$
BEGIN
  ALTER TABLE deal_documents
    ADD CONSTRAINT deal_documents_source_check
    CHECK (source IN ('banker','borrower','portal','email'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Index for checklist reconciliation queries
CREATE INDEX IF NOT EXISTS idx_deal_documents_classification
  ON deal_documents(deal_id, document_type, doc_year);
