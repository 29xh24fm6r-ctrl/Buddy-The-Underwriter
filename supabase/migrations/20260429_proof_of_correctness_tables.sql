-- Proof-of-Correctness Engine tables
-- Audit certificates and extraction exception queue

CREATE TABLE IF NOT EXISTS deal_document_audit_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL,
  deal_id UUID NOT NULL,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('AUTO_VERIFIED','FLAGGED','BLOCKED')),
  confidence_score NUMERIC(5,4),
  gates_passed JSONB NOT NULL DEFAULT '{}',
  extraction_attempt INTEGER NOT NULL DEFAULT 1,
  certificate JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_cert_document_id
  ON deal_document_audit_certificates(document_id);

ALTER TABLE deal_document_audit_certificates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all"
  ON deal_document_audit_certificates FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "authenticated_read"
  ON deal_document_audit_certificates FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE TABLE IF NOT EXISTS deal_extraction_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL,
  deal_id UUID NOT NULL,
  failed_gates JSONB NOT NULL DEFAULT '[]',
  all_attempts JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_extraction_exceptions_deal_id
  ON deal_extraction_exceptions(deal_id);

CREATE INDEX IF NOT EXISTS idx_extraction_exceptions_status
  ON deal_extraction_exceptions(status);

ALTER TABLE deal_extraction_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all"
  ON deal_extraction_exceptions FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "authenticated_read"
  ON deal_extraction_exceptions FOR SELECT
  USING (auth.role() = 'authenticated');
