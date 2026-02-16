-- Add normalized review reason code for needs-review documents.
-- Nullable text column — purely additive, no data migration needed.
ALTER TABLE deal_documents
  ADD COLUMN IF NOT EXISTS gatekeeper_review_reason_code text;
