-- Phase 2 — CCO review workflow columns
-- reviewer_notes: free-text notes captured when CCO requests changes
-- revision_requested_at: timestamp of the most recent change request

ALTER TABLE buddy_sba_packages
  ADD COLUMN IF NOT EXISTS reviewer_notes text,
  ADD COLUMN IF NOT EXISTS revision_requested_at timestamptz;
