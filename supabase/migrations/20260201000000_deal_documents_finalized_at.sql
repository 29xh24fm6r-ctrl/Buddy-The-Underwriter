-- ============================================================================
-- Mission 2: Ensure finalized_at column exists + backfill classified docs
-- ============================================================================
-- The finalized_at column gates readiness: a deal cannot be READY until all
-- deal_documents have finalized_at IS NOT NULL. Currently the column is read
-- in readiness.ts, nudges.ts, packageDeal.ts but NEVER written.
--
-- This migration:
--   1. Adds the column if missing (IF NOT EXISTS)
--   2. Backfills all already-classified docs (document_type IS NOT NULL)
--   3. Creates an idempotent RPC for code-level finalization
-- ============================================================================

-- 1. Ensure column exists
ALTER TABLE public.deal_documents
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz;

-- 2. Backfill: any doc that already has a document_type is "done"
UPDATE public.deal_documents
SET finalized_at = COALESCE(named_at, updated_at, created_at, now())
WHERE document_type IS NOT NULL
  AND finalized_at IS NULL;

-- 3. Also finalize docs with match_source = 'manual' or 'borrower_task'
--    (these were explicitly classified, no AI needed)
UPDATE public.deal_documents
SET finalized_at = COALESCE(updated_at, created_at, now())
WHERE match_source IN ('manual', 'borrower_task')
  AND finalized_at IS NULL;

-- 4. Index for the readiness hot path (count WHERE finalized_at IS NULL)
CREATE INDEX IF NOT EXISTS idx_deal_docs_pending_finalization
  ON public.deal_documents (deal_id)
  WHERE finalized_at IS NULL;
