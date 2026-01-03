-- ====================================================================
-- DEAL_DOCUMENTS.SOURCE CONSTRAINT FIX — VERIFICATION QUERIES
-- ====================================================================
-- 
-- Run these queries in Supabase SQL Editor AFTER applying the migration
-- to verify the fix is working correctly.
--

-- ====================================================================
-- 1. Verify New Constraint Definition
-- ====================================================================
-- Expected: Should show expanded array with all 8 allowed values
-- (internal, borrower, system, sys, banker_upload, borrower_portal, 
--  public_link, system_backfill)

SELECT 
  conname as constraint_name,
  contype as constraint_type,
  pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint 
WHERE conrelid = 'public.deal_documents'::regclass
  AND conname = 'deal_documents_source_check';

-- ====================================================================
-- 2. Check Recent Uploads (Last 25)
-- ====================================================================
-- Expected: Should see rows with source values like:
-- - banker_upload
-- - borrower_portal  
-- - public_link
-- - system_backfill

SELECT 
  id,
  deal_id,
  original_filename,
  source,
  created_at,
  uploader_user_id
FROM public.deal_documents
ORDER BY created_at DESC
LIMIT 25;

-- ====================================================================
-- 3. Source Value Distribution (What values are actually being used)
-- ====================================================================
-- Expected: Should show counts for each source type
-- This helps identify if any legacy values are still in the table

SELECT 
  source,
  count(*) as count,
  min(created_at) as first_seen,
  max(created_at) as last_seen
FROM public.deal_documents
GROUP BY source
ORDER BY count DESC;

-- ====================================================================
-- 4. Test Insert (Verify Constraint Allows New Values)
-- ====================================================================
-- Expected: Should succeed without constraint violation
-- NOTE: Replace with a real deal_id and bank_id from your database

-- Uncomment to test:
/*
BEGIN;

INSERT INTO public.deal_documents (
  deal_id,
  bank_id,
  original_filename,
  mime_type,
  size_bytes,
  storage_path,
  source,
  document_key
) VALUES (
  '00000000-0000-0000-0000-000000000000', -- Replace with real deal_id
  '00000000-0000-0000-0000-000000000000', -- Replace with real bank_id
  'test_constraint_verification.pdf',
  'application/pdf',
  1024,
  'test/verification/test.pdf',
  'banker_upload',  -- This should now be allowed
  'test:constraint:verification'
);

-- Verify insert succeeded
SELECT * FROM public.deal_documents 
WHERE document_key = 'test:constraint:verification';

-- Cleanup test row
DELETE FROM public.deal_documents 
WHERE document_key = 'test:constraint:verification';

ROLLBACK;  -- Don't commit test data
*/

-- ====================================================================
-- 5. Find Any Orphaned Storage Files (Optional Deep Dive)
-- ====================================================================
-- This is a complex query that would require joining with Supabase Storage
-- metadata. If you have many "missing" documents, you can use the 
-- storage API to list files and compare against this table.

-- Count documents by deal (useful for debugging)
SELECT 
  d.id as deal_id,
  d.deal_name,
  count(dd.id) as document_count,
  max(dd.created_at) as last_upload
FROM public.deals d
LEFT JOIN public.deal_documents dd ON dd.deal_id = d.id
GROUP BY d.id, d.deal_name
ORDER BY document_count DESC
LIMIT 50;

-- ====================================================================
-- 6. Check for Failed Uploads (Documents uploaded but not persisted)
-- ====================================================================
-- NOTE: This requires that you have some logging/audit table
-- If you don't have one, skip this check

-- Example if you have deal_upload_audit or similar:
/*
SELECT 
  a.file_id,
  a.original_filename,
  a.created_at as attempted_at,
  CASE 
    WHEN d.id IS NULL THEN 'MISSING FROM deal_documents'
    ELSE 'OK'
  END as status
FROM deal_upload_audit a
LEFT JOIN deal_documents d ON d.id = a.file_id
WHERE a.created_at > NOW() - INTERVAL '7 days'
ORDER BY a.created_at DESC;
*/

-- ====================================================================
-- EXPECTED RESULTS SUMMARY
-- ====================================================================
-- 
-- Query 1: Constraint definition should include all 8 values
-- Query 2: Recent uploads should have new source values (banker_upload, etc.)
-- Query 3: Distribution should show usage of new canonical values
-- Query 4: Test insert should succeed (when uncommented with real IDs)
-- Query 5: Should show normal document counts per deal
-- 
-- If Query 2 shows NO recent uploads or Query 3 shows NO new source values,
-- that means:
-- - Migration applied ✅
-- - But no new uploads have happened yet ⏳
-- - Try uploading a file via UI to generate test data
-- 
-- ====================================================================
