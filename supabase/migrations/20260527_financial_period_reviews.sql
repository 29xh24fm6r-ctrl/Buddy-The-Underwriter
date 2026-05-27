-- SPEC-FINANCIAL-PERIOD-REVIEW-QUEUE-1
--
-- Financial Statement Period Reviews — manual resolution queue for documents
-- whose canonical type is known but whose reporting period is ambiguous.
--
-- This is NOT a classification fix. The classifier correctly identified the
-- document type. This table tracks human review of period ambiguity.

CREATE TABLE IF NOT EXISTS financial_statement_period_reviews (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id                 uuid NOT NULL,
  document_id             uuid NOT NULL,
  bank_id                 uuid NOT NULL,

  -- Snapshot of current state at review creation
  current_document_type   text NOT NULL,
  current_canonical_type  text NOT NULL,
  current_checklist_key   text,
  current_statement_period text,

  -- Why this document needs review
  review_reason           text NOT NULL,

  -- Status: OPEN → RESOLVED | NOT_APPLICABLE | BORROWER_CLARIFICATION_REQUESTED
  status                  text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'RESOLVED', 'NOT_APPLICABLE', 'BORROWER_CLARIFICATION_REQUESTED')),

  -- Resolution fields (populated on resolve)
  reviewer_user_id        text,
  reviewer_decision       text
    CHECK (reviewer_decision IS NULL OR reviewer_decision IN (
      'CONFIRM_CURRENT_BS', 'CONFIRM_HISTORICAL_BS',
      'CONFIRM_YTD_IS', 'CONFIRM_ANNUAL_IS',
      'CONFIRM_GENERIC_FS', 'NOT_APPLICABLE', 'CLARIFICATION_REQUESTED'
    )),
  confirmed_statement_period text
    CHECK (confirmed_statement_period IS NULL OR confirmed_statement_period IN (
      'CURRENT', 'HISTORICAL', 'YTD', 'ANNUAL', 'INTERIM', 'FYE'
    )),
  confirmed_checklist_key text,
  reviewer_note           text,
  resolved_at             timestamptz,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- One open review per document at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_period_reviews_open_per_doc
  ON financial_statement_period_reviews (document_id)
  WHERE status = 'OPEN';

-- Fast lookup by deal
CREATE INDEX IF NOT EXISTS idx_period_reviews_deal
  ON financial_statement_period_reviews (deal_id, status);

-- RLS: service role only (admin tool, not banker-facing yet)
ALTER TABLE financial_statement_period_reviews ENABLE ROW LEVEL SECURITY;
