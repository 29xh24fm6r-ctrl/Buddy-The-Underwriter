-- ==============================
-- BORROWER PORTAL SANITY CHECK QUERIES
-- Run these after applying the RPC migration
-- ==============================

-- STEP 1: Verify checklist seeding works
-- Replace :deal_id with your actual deal UUID
-- Expected: Multiple rows (business tax return, personal tax return, financial statements, etc.)

\echo '=== STEP 1: Check Deal Checklist Items ==='

select 
  checklist_key, 
  title, 
  required, 
  received_at,
  received_upload_id
from public.deal_checklist_items
where deal_id = :deal_id
order by checklist_key;

-- If empty, the "Save + Auto-Seed Checklist" button didn't work
-- Check: Does the deal exist? Run:
-- select id, name, borrower_name from public.deals where id = :deal_id;


-- STEP 2: Verify borrower portal link exists
-- Expected: At least one row with token, expires_at, and single_use=true

\echo ''
\echo '=== STEP 2: Check Borrower Portal Links ==='

select 
  id, 
  deal_id, 
  label, 
  single_use, 
  expires_at, 
  used_at,
  substring(token, 1, 12) || '...' as token_preview,
  created_at
from public.borrower_portal_links
where deal_id = :deal_id
order by created_at desc;

-- If empty, the banker hasn't sent a portal link yet
-- Create one via: POST /api/portal/create-link { "deal_id": "..." }


-- STEP 3: Test the RPC functions (borrower's perspective)
-- Replace :test_token with the actual token from step 2

\echo ''
\echo '=== STEP 3: Test portal_get_context RPC ==='

select * from public.portal_get_context(:test_token);

-- Expected: Returns deal_id, link_id, label, single_use, expires_at, used_at
-- If error: Token expired or doesn't exist


\echo ''
\echo '=== STEP 3b: Test portal_list_uploads RPC ==='

select * from public.portal_list_uploads(:test_token);

-- Expected: Returns uploads for this deal (may be empty initially)
-- Columns: id, deal_id, filename, mime_type, size_bytes, status, doc_type, checklist_key, created_at


-- STEP 4: After borrower confirms + submits, verify submissions

\echo ''
\echo '=== STEP 4: Check Doc Submissions ==='

select 
  id, 
  deal_id, 
  upload_id, 
  substring(token, 1, 12) || '...' as token_preview,
  status, 
  created_at
from public.doc_submissions
where deal_id = :deal_id
order by created_at desc;

-- Expected: One row per confirmed document
-- status should be 'submitted' or 'pending'


\echo ''
\echo '=== STEP 4b: Check Checklist Items Updated ==='

select 
  checklist_key, 
  title,
  required,
  received_at, 
  received_upload_id
from public.deal_checklist_items
where deal_id = :deal_id
  and received_at is not null
order by received_at desc;

-- Expected: Items that were matched have received_at populated
-- received_upload_id should match an upload


-- STEP 5: Verify underwriting readiness trigger

\echo ''
\echo '=== STEP 5: Check Underwriting Ready Status ==='

select 
  id,
  name,
  stage,
  underwriting_ready,
  underwriting_ready_at,
  underwriting_started_at
from public.deals
where id = :deal_id;

-- Expected: If all required checklist items received → underwriting_ready_at is set


-- STEP 6: Verify deal events (audit trail)

\echo ''
\echo '=== STEP 6: Check Deal Events (Audit Trail) ==='

select 
  created_at::timestamp as event_time,
  kind,
  metadata as payload
from public.deal_events
where deal_id = :deal_id
order by created_at desc
limit 50;

-- Expected events:
-- - 'field_confirmed' when borrower confirms a field
-- - 'doc_submitted' when borrower submits document
-- - 'checklist_item_received' when item matched
-- - 'deal_ready_for_underwriting' when all required items received


-- STEP 7: Check outbound messages (SMS/email log)

\echo ''
\echo '=== STEP 7: Check Outbound Messages ==='

select 
  created_at::timestamp,
  channel,
  to_value,
  status,
  provider,
  error,
  sent_at::timestamp
from public.outbound_messages
where deal_id = :deal_id
order by created_at desc;

-- Expected: If SMS sent, should see 'sms' channel with status 'sent' or 'failed'
-- Check error column if failed


-- BONUS: Verify RPC grants to anon

\echo ''
\echo '=== BONUS: Verify RPC Grants to Anon ==='

select 
  routine_name,
  string_agg(grantee, ', ') as granted_to
from information_schema.routine_privileges
where routine_name like 'portal_%'
  and routine_schema = 'public'
group by routine_name
order by routine_name;

-- Expected: All 4 portal_* functions should have 'anon' in granted_to
-- - portal_confirm_and_submit_document
-- - portal_get_context
-- - portal_get_doc_fields
-- - portal_list_uploads

