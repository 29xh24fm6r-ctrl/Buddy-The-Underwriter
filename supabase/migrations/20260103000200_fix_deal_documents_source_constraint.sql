-- Fix deal_documents.source CHECK constraint
-- 
-- PROBLEM: The existing constraint only allowed a small enum (internal, borrower, sys...)
--          but the app writes values like: banker_upload, borrower_portal, public_link
-- 
-- SOLUTION: Drop the overly strict constraint and recreate with expanded allowed values
--
-- Run in Supabase SQL Editor (production + preview environments)

begin;

-- 1) Drop the overly strict enum check
alter table public.deal_documents
drop constraint if exists deal_documents_source_check;

-- 2) Recreate with expanded allowed values matching IngestSource type
-- Keeps old values for backwards compat (internal/borrower/system)
-- Adds new canonical values used by app (banker_upload, borrower_portal, public_link, system_backfill)
alter table public.deal_documents
add constraint deal_documents_source_check
check (
  source is null
  or source = any (
    array[
      -- Legacy values (backward compatibility)
      'internal',
      'borrower',
      'system',
      'sys',
      -- New canonical IngestSource values
      'banker_upload',
      'borrower_portal',
      'public_link',
      'system_backfill'
    ]::text[]
  )
);

commit;
