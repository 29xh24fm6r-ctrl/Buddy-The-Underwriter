-- Phase 2: IRS Knowledge Base — validation results table
-- Stores identity check results per extracted document

CREATE TABLE IF NOT EXISTS deal_document_validation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL,
  deal_id UUID NOT NULL,
  form_type TEXT NOT NULL,
  tax_year INTEGER,
  status TEXT NOT NULL CHECK (status IN ('VERIFIED','FLAGGED','BLOCKED','PARTIAL')),
  check_results JSONB NOT NULL DEFAULT '[]',
  passed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  validated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_validation_document_id ON deal_document_validation_results(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_validation_deal_id ON deal_document_validation_results(deal_id);
CREATE INDEX IF NOT EXISTS idx_doc_validation_status ON deal_document_validation_results(status);

ALTER TABLE deal_document_validation_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON deal_document_validation_results FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "authenticated_read" ON deal_document_validation_results FOR SELECT USING (auth.role() = 'authenticated');
