# Fix for Deal Files (0) Bug - Verification Guide

## Problem
The Deal Cockpit was showing "Deal Files (0)" even when documents existed. The root cause was that the `list_deal_documents` RPC referenced columns not present in the production `deal_documents` table:
- `entity_name`
- `uploader_user_id`
- `uploaded_via_link_id`
- `sha256`

This caused silent Postgres errors, which the route handler converted to empty file lists.

## Solution Implemented

### 1. Migration: `20260205_fix_list_deal_documents_rpc.sql`
- Created a new RPC definition that only selects columns guaranteed to exist
- Removed references to columns that may not be present in all environments
- Now returns only these columns:
  - id, deal_id, storage_bucket, storage_path
  - original_filename, display_name, document_type, doc_year
  - naming_method, mime_type, size_bytes
  - source, checklist_key, created_at

### 2. Route Enhancement: `src/app/api/deals/[dealId]/files/list/route.ts`
- Added fallback logic if RPC fails
- Now logs actual Postgres error details (code, message, hint)
- Falls back to direct SELECT from deal_documents if RPC fails
- Returns proper error codes to help debug future issues

## Verification Steps

### 1. Apply the Migration
```bash
# If using Supabase CLI locally:
npx supabase db reset

# Or on production/staging via dashboard or CLI:
npx supabase db push
```

### 2. Test the Endpoint
```bash
# Replace DEAL_ID with an actual deal ID from your database
curl -sS "http://localhost:3000/api/deals/DEAL_ID/files/list" | jq

# Expected response:
# { "ok": true, "files": [...] }
```

### 3. Check the UI
1. Navigate to a deal in the Deal Cockpit
2. Look at the left column
3. Should show "Deal Files (N)" where N is the actual count
4. Should display the list of documents

### 4. Verify Logs
If the RPC was failing before, you should now see logs like:
```
[/api/deals/[dealId]/files/list] RPC failed, attempting fallback
```

After migration, the RPC should succeed and no fallback logs should appear.

## Files Changed
- ✅ `supabase/migrations/20260205_fix_list_deal_documents_rpc.sql` - New migration
- ✅ `src/app/api/deals/[dealId]/files/list/route.ts` - Enhanced error handling

## Additional Notes
- The route now handles RPC failures gracefully with a fallback
- Error details are logged for debugging
- The fix is backward compatible - old clients will continue to work
- Consider running this on staging before production
