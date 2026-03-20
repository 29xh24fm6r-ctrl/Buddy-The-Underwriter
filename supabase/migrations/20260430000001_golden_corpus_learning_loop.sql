-- Golden Corpus + Continuous Learning tables

CREATE TABLE IF NOT EXISTS extraction_correction_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL,
  document_id UUID NOT NULL,
  document_type TEXT NOT NULL,
  tax_year INTEGER,
  naics_code TEXT,
  fact_key TEXT NOT NULL,
  original_value NUMERIC,
  corrected_value NUMERIC,
  correction_source TEXT NOT NULL,
  analyst_id TEXT,
  corrected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_correction_log_fact_key
  ON extraction_correction_log(fact_key);

CREATE INDEX IF NOT EXISTS idx_correction_log_document_type
  ON extraction_correction_log(document_type, fact_key);

CREATE INDEX IF NOT EXISTS idx_correction_log_corrected_at
  ON extraction_correction_log(corrected_at);

ALTER TABLE extraction_correction_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON extraction_correction_log
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "authenticated_read" ON extraction_correction_log
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE TABLE IF NOT EXISTS extraction_learning_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date DATE NOT NULL,
  patterns JSONB NOT NULL DEFAULT '[]',
  top_errors JSONB NOT NULL DEFAULT '[]',
  new_flags JSONB NOT NULL DEFAULT '[]',
  improving_fields JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_reports_date
  ON extraction_learning_reports(report_date);

ALTER TABLE extraction_learning_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON extraction_learning_reports
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "authenticated_read" ON extraction_learning_reports
  FOR SELECT USING (auth.role() = 'authenticated');
