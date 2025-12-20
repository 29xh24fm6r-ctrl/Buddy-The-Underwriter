-- ============================================================
-- Pack Templates System - Verification Queries
-- ============================================================
-- Use these queries to verify the system is working correctly
-- after applying the migration and seeding Pack templates.
-- ============================================================

-- ------------------------------------------------------------
-- 1. VERIFY PACK STRUCTURE
-- ------------------------------------------------------------
-- Shows all Pack templates and their items for a bank
SELECT 
  pt.id as pack_id,
  pt.name as pack_name,
  pt.loan_type,
  pt.loan_program,
  pt.active,
  pti.id as item_id,
  pti.title as item_title,
  pti.category,
  pti.doc_type,
  pti.required,
  pti.sort_order
FROM borrower_pack_templates pt
LEFT JOIN borrower_pack_template_items pti ON pti.pack_id = pt.id
WHERE pt.bank_id = '<your-bank-id>'
ORDER BY pt.sort_order, pt.name, pti.sort_order;

-- ------------------------------------------------------------
-- 2. VERIFY PACK WAS APPLIED TO DEAL
-- ------------------------------------------------------------
-- Shows all Pack-generated requests for a deal
SELECT 
  dr.id as request_id,
  dr.title,
  dr.category,
  dr.status,
  dr.source,
  dr.sort_order,
  pt.name as pack_name,
  pti.title as template_title,
  dr.created_at
FROM borrower_document_requests dr
LEFT JOIN borrower_pack_templates pt ON dr.pack_id = pt.id
LEFT JOIN borrower_pack_template_items pti ON dr.pack_item_id = pti.id
WHERE dr.deal_id = '<your-deal-id>'
AND dr.source = 'pack'
ORDER BY dr.sort_order;

-- Expected: Should see rows with source='pack', pack_id filled in

-- ------------------------------------------------------------
-- 3. VERIFY NO DUPLICATE INVITES (CANONICAL RULE #1)
-- ------------------------------------------------------------
-- Ensures only borrower_invites table is used (no parallel tables)
SELECT 
  deal_id,
  COUNT(*) as invite_count,
  MAX(created_at) as latest_invite
FROM borrower_invites
WHERE deal_id = '<your-deal-id>'
GROUP BY deal_id;

-- Expected: Small number (1-2 invites per deal)

-- ------------------------------------------------------------
-- 4. VERIFY TOKEN HASH FORMAT (CANONICAL RULE #2)
-- ------------------------------------------------------------
-- Ensures SHA256 base64url is used (not plain tokens)
SELECT 
  id,
  deal_id,
  LENGTH(token_hash) as hash_length,
  token_hash
FROM borrower_invites
WHERE deal_id = '<your-deal-id>'
LIMIT 1;

-- Expected: hash_length should be 43 (SHA256 base64url = 43 chars)

-- ------------------------------------------------------------
-- 5. VERIFY UPLOAD INBOX
-- ------------------------------------------------------------
-- Shows all uploads with match status
SELECT 
  id,
  filename,
  status,
  match_confidence,
  match_reason,
  hinted_doc_type,
  hinted_category,
  created_at
FROM borrower_upload_inbox
WHERE deal_id = '<your-deal-id>'
ORDER BY created_at DESC;

-- Status values: 'unmatched', 'attached', 'rejected'

-- ------------------------------------------------------------
-- 6. VERIFY 85% CONFIDENCE THRESHOLD (CANONICAL RULE #6)
-- ------------------------------------------------------------
-- Ensures no low-confidence uploads are auto-attached
SELECT 
  filename,
  match_confidence,
  status,
  match_reason
FROM borrower_upload_inbox
WHERE deal_id = '<your-deal-id>'
AND match_confidence < 85
AND status = 'attached';

-- Expected: 0 rows (no uploads below 85% should be auto-attached)

-- ------------------------------------------------------------
-- 7. VERIFY AUTO-MATCH ACCURACY
-- ------------------------------------------------------------
-- Shows auto-match performance (confidence distribution)
SELECT 
  CASE 
    WHEN match_confidence >= 85 THEN 'High (≥85%)'
    WHEN match_confidence >= 70 THEN 'Medium (70-84%)'
    WHEN match_confidence >= 40 THEN 'Low (40-69%)'
    ELSE 'Very Low (<40%)'
  END as confidence_bucket,
  COUNT(*) as upload_count,
  AVG(match_confidence) as avg_confidence
FROM borrower_upload_inbox
WHERE deal_id = '<your-deal-id>'
GROUP BY confidence_bucket
ORDER BY MIN(match_confidence) DESC;

-- ------------------------------------------------------------
-- 8. VERIFY REQUEST STATUS FLOW
-- ------------------------------------------------------------
-- Shows request lifecycle (requested → received)
SELECT 
  title,
  status,
  source,
  received_filename,
  received_at,
  created_at,
  updated_at
FROM borrower_document_requests
WHERE deal_id = '<your-deal-id>'
ORDER BY sort_order;

-- Expected statuses: 'requested', 'uploaded', 'accepted', 'rejected'

-- ------------------------------------------------------------
-- 9. VERIFY BANK_ID + DEAL_ID EVERYWHERE (CANONICAL RULE #3)
-- ------------------------------------------------------------
-- Ensures no orphan data (all rows have bank_id + deal_id)

-- Check borrower_document_requests
SELECT COUNT(*) as missing_bank_or_deal
FROM borrower_document_requests
WHERE bank_id IS NULL OR deal_id IS NULL;
-- Expected: 0

-- Check borrower_upload_inbox
SELECT COUNT(*) as missing_bank_or_deal
FROM borrower_upload_inbox
WHERE bank_id IS NULL OR deal_id IS NULL;
-- Expected: 0

-- Check borrower_invites
SELECT COUNT(*) as missing_bank_or_deal
FROM borrower_invites
WHERE bank_id IS NULL OR deal_id IS NULL;
-- Expected: 0

-- ------------------------------------------------------------
-- 10. VERIFY PACK SCORING LOGIC
-- ------------------------------------------------------------
-- Shows which Packs would match a deal (simulates scorePackMatch)
SELECT 
  pt.id as pack_id,
  pt.name as pack_name,
  pt.loan_type as pack_loan_type,
  pt.loan_program as pack_loan_program,
  d.loan_type as deal_loan_type,
  d.loan_program as deal_loan_program,
  CASE 
    WHEN pt.loan_type = d.loan_type AND pt.loan_program = d.loan_program THEN 100
    WHEN pt.loan_type = d.loan_type AND pt.loan_program IS NULL THEN 80
    WHEN pt.loan_type = d.loan_type THEN 70
    ELSE 0
  END as match_score
FROM borrower_pack_templates pt
CROSS JOIN deals d
WHERE d.id = '<your-deal-id>'
AND pt.bank_id = d.bank_id
AND pt.active = true
ORDER BY match_score DESC;

-- Expected: Highest scoring Pack should match what applyBestPackToDeal chose

-- ------------------------------------------------------------
-- 11. VERIFY EXCEPTION QUEUE (BANKER INBOX)
-- ------------------------------------------------------------
-- Shows uploads awaiting banker review (<85% confidence)
SELECT 
  inbox.id,
  inbox.filename,
  inbox.match_confidence,
  inbox.match_reason,
  inbox.status,
  req.title as best_match_request,
  inbox.created_at
FROM borrower_upload_inbox inbox
LEFT JOIN borrower_document_requests req ON inbox.matched_request_id = req.id
WHERE inbox.deal_id = '<your-deal-id>'
AND inbox.status = 'unmatched'
ORDER BY inbox.created_at DESC;

-- These uploads need banker attention

-- ------------------------------------------------------------
-- 12. VERIFY NO PARALLEL SYSTEMS
-- ------------------------------------------------------------
-- Ensures Pack system didn't create duplicate tables

-- Check for borrower_portal_invites table (should NOT exist)
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'borrower_portal_invites'
) as has_duplicate_invite_table;
-- Expected: false

-- ------------------------------------------------------------
-- 13. FULL DEAL DIAGNOSTIC
-- ------------------------------------------------------------
-- Comprehensive view of a deal's Pack/Portal state
SELECT 
  d.id as deal_id,
  d.name as deal_name,
  d.loan_type,
  d.loan_program,
  COUNT(DISTINCT dr.id) as total_requests,
  COUNT(DISTINCT CASE WHEN dr.source = 'pack' THEN dr.id END) as pack_requests,
  COUNT(DISTINCT CASE WHEN dr.status = 'received' THEN dr.id END) as received_requests,
  COUNT(DISTINCT inbox.id) as total_uploads,
  COUNT(DISTINCT CASE WHEN inbox.status = 'attached' THEN inbox.id END) as attached_uploads,
  COUNT(DISTINCT CASE WHEN inbox.status = 'unmatched' THEN inbox.id END) as unmatched_uploads,
  COUNT(DISTINCT inv.id) as invite_count
FROM deals d
LEFT JOIN borrower_document_requests dr ON dr.deal_id = d.id
LEFT JOIN borrower_upload_inbox inbox ON inbox.deal_id = d.id
LEFT JOIN borrower_invites inv ON inv.deal_id = d.id
WHERE d.id = '<your-deal-id>'
GROUP BY d.id, d.name, d.loan_type, d.loan_program;

-- ------------------------------------------------------------
-- 14. VERIFY PACK NEVER CREATED INVITES (CANONICAL RULE #4)
-- ------------------------------------------------------------
-- Check audit trail - invites should only come from invite endpoint
SELECT 
  inv.id,
  inv.created_at,
  inv.created_by, -- should be banker user_id, not null
  inv.deal_id
FROM borrower_invites inv
WHERE inv.deal_id = '<your-deal-id>'
ORDER BY inv.created_at;

-- If created_by is null for invites created after Pack application,
-- that would violate canonical rule #4

-- ------------------------------------------------------------
-- 15. SAMPLE DATA FOR TESTING
-- ------------------------------------------------------------
-- Use this to create a test Pack + items

/*
-- Create Pack
INSERT INTO borrower_pack_templates (bank_id, name, loan_type, loan_program, active)
VALUES ('<your-bank-id>', 'SBA 7(a) Purchase Standard', 'Purchase', 'SBA 7(a)', true)
RETURNING id;

-- Create Pack Items (use the returned pack_id)
INSERT INTO borrower_pack_template_items (pack_id, title, category, doc_type, required, sort_order, active)
VALUES
  ('<pack-id>', 'Personal Tax Returns (3 years)', 'Financial', 'tax_return', true, 1, true),
  ('<pack-id>', 'Business Tax Returns (3 years)', 'Financial', 'tax_return', true, 2, true),
  ('<pack-id>', 'YTD Profit & Loss', 'Financial', 'profit_loss', true, 3, true),
  ('<pack-id>', 'YTD Balance Sheet', 'Financial', 'balance_sheet', true, 4, true),
  ('<pack-id>', 'Purchase Agreement', 'Legal', 'purchase_agreement', true, 5, true),
  ('<pack-id>', 'Business License', 'Business', 'license', false, 6, true),
  ('<pack-id>', 'Business Plan', 'Business', 'business_plan', false, 7, true);

-- Apply Pack to deal (via API)
-- POST /api/deals/<deal-id>/packs/apply
*/

