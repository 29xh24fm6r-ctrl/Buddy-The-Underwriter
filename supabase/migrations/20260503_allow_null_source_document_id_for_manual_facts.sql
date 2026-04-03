-- Allow source_document_id to be null for manually-entered facts
-- (facts sourced from banker input, not a document)
ALTER TABLE deal_financial_facts
  ALTER COLUMN source_document_id DROP NOT NULL;
