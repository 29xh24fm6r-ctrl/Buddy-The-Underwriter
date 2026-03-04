-- Phase P: Add statement_period discriminator for financial statements
-- Used by resolveChecklistKey to disambiguate IS (YTD/ANNUAL) and BS (CURRENT/HISTORICAL)

ALTER TABLE deal_documents
  ADD COLUMN IF NOT EXISTS statement_period TEXT;

-- Constraint: only allow known values
ALTER TABLE deal_documents
  ADD CONSTRAINT valid_statement_period
  CHECK (statement_period IS NULL OR statement_period IN ('YTD', 'ANNUAL', 'CURRENT', 'HISTORICAL'));

COMMENT ON COLUMN deal_documents.statement_period IS 'Financial statement discriminator: YTD/ANNUAL for income statements, CURRENT/HISTORICAL for balance sheets';
