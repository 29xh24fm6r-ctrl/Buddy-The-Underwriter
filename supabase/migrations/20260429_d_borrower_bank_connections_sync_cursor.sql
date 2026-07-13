-- SPEC S2 C-2 sync.ts implements Plaid's /transactions/sync cursor
-- pattern, which requires persisting next_cursor between calls. The A-3
-- schema didn't include a column for it — additive fix.
BEGIN;
ALTER TABLE public.borrower_bank_connections
  ADD COLUMN IF NOT EXISTS plaid_sync_cursor text;
COMMIT;
