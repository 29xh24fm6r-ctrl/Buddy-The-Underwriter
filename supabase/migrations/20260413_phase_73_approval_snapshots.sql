-- Phase 73B: Add immutable approval snapshots to draft_borrower_requests
--
-- approved_snapshot: frozen copy of {draft_subject, draft_message, evidence} at approval time
-- sent_snapshot: frozen copy of exactly what was delivered to borrower
--
-- These columns are IMMUTABLE after write — application code MUST NOT update them once set.

ALTER TABLE draft_borrower_requests
  ADD COLUMN IF NOT EXISTS approved_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS sent_snapshot JSONB;

COMMENT ON COLUMN draft_borrower_requests.approved_snapshot IS
  'Frozen copy of {draft_subject, draft_message, evidence} at approval time. Immutable after write.';
COMMENT ON COLUMN draft_borrower_requests.sent_snapshot IS
  'Frozen copy of exactly what was delivered to borrower. Immutable after write.';
