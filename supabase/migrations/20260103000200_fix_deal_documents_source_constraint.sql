-- Fix deal_documents.source CHECK constraint
-- 
-- PROBLEM: Existing constraint only allows: internal, borrower, system, sys (truncated list from error)
--          App writes: banker_upload, borrower_portal, public_link, system_backfill
--          Result: Storage upload succeeds, DB insert fails silently on constraint violation
-- 
-- SOLUTION: 
--   1. Expand constraint to include 'public' (for public_link mapping)
--   2. App normalizes IngestSource values to allowed constraint values
--
-- Run in Supabase SQL Editor (production + preview environments)

begin;

-- Drop the overly strict enum check
alter table public.deal_documents
drop constraint if exists deal_documents_source_check;

-- Recreate with expanded allowed values
-- Keep legacy values + add 'public' for public_link mapping
alter table public.deal_documents
add constraint deal_documents_source_check
check (
  source is null
  or source = any (
    array[
      'internal',        -- used by banker_upload
      'borrower',        -- used by borrower_portal
      'public',          -- used by public_link (NEW)
      'system',          -- used by system_backfill
      'sys'              -- legacy alias for system
    ]::text[]
  )
);

commit;
