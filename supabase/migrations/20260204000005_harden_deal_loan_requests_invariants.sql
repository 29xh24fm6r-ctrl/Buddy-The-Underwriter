-- 20260204_harden_deal_loan_requests_invariants.sql
-- Harden deal_loan_requests: ensure amount is present once request leaves draft.

BEGIN;

-- requested_amount must be present once not draft
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'deal_loan_requests_amount_required_when_not_draft'
  ) THEN
    ALTER TABLE public.deal_loan_requests
      ADD CONSTRAINT deal_loan_requests_amount_required_when_not_draft
      CHECK (
        status = 'draft'
        OR requested_amount IS NOT NULL
      );
  END IF;
END $$;

COMMIT;
