-- MEGA STEP 8: Correct Idempotency Index (attachment_id not file_id)
-- 
-- Prevents duplicate OCR jobs for same attachment
-- Uses partial index (only active jobs) for performance
-- 
-- Run: supabase migration new fix_ocr_idempotency_index

-- Drop old index if exists (may have wrong column name)
drop index if exists public.uq_document_jobs_ocr_active;

-- Create correct unique index
-- Prevents enqueueing OCR for same attachment_id while job is active
create unique index if not exists uq_document_jobs_ocr_active
  on public.document_jobs (deal_id, attachment_id, job_type)
  where job_type = 'OCR'
    and status in ('queued', 'leased', 'running');

-- Explanation:
-- This index guarantees:
-- 1. At most ONE active OCR job per (deal_id, attachment_id) pair
-- 2. After job completes (success/failed), can retry (new job allowed)
-- 3. INSERT ... ON CONFLICT DO NOTHING will silently skip duplicates
-- 4. Partial index = only indexes active jobs (fast, small)
-- 
-- Why this matters:
-- - "Run OCR on all" can be clicked 100 times → only enqueues once
-- - Worker can be restarted mid-processing → no duplicate work
-- - Evidence is deterministic: "3 files not OCR'd" is always correct
