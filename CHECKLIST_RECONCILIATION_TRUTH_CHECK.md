# 🔥 CHECKLIST RECONCILIATION: THE REAL FIX

**Date**: December 31, 2025  
**Status**: ✅ **SYSTEM COMPLETE + NEEDS MIGRATION**

---

## 🎯 THE SINGLE SOURCE OF TRUTH PRINCIPLE

**Every document that should satisfy a checklist item must produce exactly one row in `deal_documents` with `deal_id` + `checklist_key`.**

Everything else becomes automatic via DB triggers.

---

## ✅ WHAT'S ALREADY CORRECT

### Upload Flow (`directDealDocumentUpload`)
**File**: `src/lib/uploads/uploadFile.ts`

The canonical upload helper already:
1. ✅ Creates `deal_documents` row for every upload
2. ✅ Sets `checklist_key` if provided (or `null` if unknown)
3. ✅ Used by ALL upload paths:
   - Banker uploads (`/deals/new`, `UploadBox`)
   - Borrower portal (`/portal/[token]`)
   - Internal document uploads

**Flow**:
```typescript
// 1. Get signed URL
POST /api/deals/[dealId]/files/sign
Body: { filename, mime_type, checklist_key }

// 2. Upload bytes to storage
PUT <signed_url>

// 3. Record metadata → CREATES deal_documents ROW
POST /api/deals/[dealId]/files/record
Body: { file_id, object_path, checklist_key, ... }
```

**Result**: Every file gets a `deal_documents` row!

---

## ⚡ WHAT THE TRIGGERS DO

**File**: `supabase/migrations/20251231000000_checklist_docs_reconciliation.sql`

When `deal_documents.checklist_key` is set (insert or update):
```sql
UPDATE deal_checklist_items
SET
  received_at = coalesce(received_at, now()),
  status = 'received',
  received_document_id = NEW.id
WHERE deal_id = NEW.deal_id
  AND checklist_key = NEW.checklist_key;
```

**Covers**:
- ✅ Docs uploaded with `checklist_key` known upfront
- ✅ Auto-match stamping `checklist_key` later
- ✅ Manual admin updates

---

## 🐛 WHY ITEMS STILL SHOW "PENDING"

**Three possibilities**:

### A) Migration Not Run Yet ❌
Triggers don't exist in production DB.

**Test**:
```sql
select trigger_name from information_schema.triggers 
where trigger_name like '%checklist_received%';
```

**Expected**: 2 rows (one for `deal_documents`, one for `deal_files`)  
**If empty**: Run the migration!

---

### B) Docs Exist But `checklist_key` Is NULL ❌
Auto-match logic didn't recognize filename.

**Test** (Run in Supabase for your deal):
```sql
select
  c.checklist_key,
  c.required,
  c.status,
  c.received_at,
  (select count(*) from deal_documents d 
   where d.deal_id = c.deal_id 
   and d.checklist_key = c.checklist_key) as docs_count,
  (select count(*) from deal_files f 
   where f.deal_id = c.deal_id 
   and f.checklist_key = c.checklist_key) as files_count
from deal_checklist_items c
where c.deal_id = 'YOUR_DEAL_ID'
order by c.checklist_key;
```

**Expected**:
- If `docs_count > 0` or `files_count > 0` → should have `received_at != null`
- If all `docs_count = 0` AND `files_count = 0` → docs never got `checklist_key` stamped

**Check uploaded docs**:
```sql
select 
  id,
  original_filename,
  checklist_key,  -- If NULL, auto-match didn't work
  created_at
from deal_documents
where deal_id = 'YOUR_DEAL_ID'
order by created_at desc
limit 20;
```

**If `checklist_key` is NULL**: Auto-match logic needs improvement

---

### C) Using Wrong Table (`borrower_uploads` instead of `deal_documents`) ❌

Some old code might still use `borrower_uploads` table.

**Test**:
```sql
-- Check if docs are in borrower_uploads instead
select count(*) from borrower_uploads where deal_id = 'YOUR_DEAL_ID';

-- Check if docs are in deal_documents
select count(*) from deal_documents where deal_id = 'YOUR_DEAL_ID';
```

**Expected**: Docs should be in `deal_documents` (current code uses it)  
**If in `borrower_uploads`**: Old code path, needs migration

---

## 🚀 THE FIX (Already Implemented!)

### Layer 1: DB Triggers (Real-time) ✅
**Status**: ⚠️ **Needs migration run**

Auto-marks checklist items received when `checklist_key` is set on docs.

---

### Layer 2: Auto-Seed Reconciliation (Batch) ✅
**Status**: ✅ **Deployed**

After auto-matching files, immediately reconciles:
```typescript
// In /api/deals/[dealId]/auto-seed
const keys = await getDocsWithChecklistKeys(dealId);
await markChecklistItemsReceived(dealId, keys);
```

---

### Layer 3: Manual Reconciliation (On-Demand) ✅
**Status**: ✅ **Deployed**

```bash
curl -X POST "$PREVIEW_URL/api/deals/$DEAL_ID/checklist/reconcile" \
  -H "Cookie: YOUR_CLERK_COOKIE"
```

---

## 📋 VERIFICATION CHECKLIST

Run these queries in **Supabase SQL Editor** for deal `373ccd15-619f-4af7-aaf1-6e5f6ed596df`:

### 1️⃣ Check if triggers exist
```sql
select 
  trigger_name, 
  event_manipulation, 
  event_object_table
from information_schema.triggers
where trigger_name like '%checklist_received%';
```

**Expected**: 2 rows  
**If 0 rows**: Migration not run → **DO THIS NOW**

---

### 2️⃣ Truth check: Checklist ↔ Docs reconciliation
```sql
select
  c.checklist_key,
  c.title,
  c.required,
  c.status,
  c.received_at,
  (select count(*) from deal_documents d 
   where d.deal_id = c.deal_id 
   and d.checklist_key = c.checklist_key) as docs_count,
  (select count(*) from deal_files f 
   where f.deal_id = c.deal_id 
   and f.checklist_key = c.checklist_key) as files_count,
  (select array_agg(d.original_filename) 
   from deal_documents d 
   where d.deal_id = c.deal_id 
   and d.checklist_key = c.checklist_key) as matching_docs
from deal_checklist_items c
where c.deal_id = '373ccd15-619f-4af7-aaf1-6e5f6ed596df'
order by c.required desc, c.checklist_key;
```

**What to look for**:
- ✅ `docs_count > 0` AND `received_at != null` → **WORKING**
- ❌ `docs_count > 0` BUT `received_at IS null` → Trigger not fired (migration needed)
- ❌ `docs_count = 0` AND `files_count = 0` → No docs uploaded with that `checklist_key`

---

### 3️⃣ Check uploaded documents
```sql
select 
  id,
  original_filename,
  checklist_key,
  document_key,
  source,
  created_at,
  updated_at
from deal_documents
where deal_id = '373ccd15-619f-4af7-aaf1-6e5f6ed596df'
order by created_at desc;
```

**What to look for**:
- ✅ `checklist_key` populated → Good, will trigger reconciliation
- ❌ `checklist_key IS null` → Auto-match didn't work, needs manual fix

---

### 4️⃣ Check if using wrong table
```sql
-- Should be ZERO (old system)
select count(*) as borrower_uploads_count
from borrower_uploads 
where deal_id = '373ccd15-619f-4af7-aaf1-6e5f6ed596df';

-- Should be > 0 (current system)
select count(*) as deal_documents_count
from deal_documents 
where deal_id = '373ccd15-619f-4af7-aaf1-6e5f6ed596df';
```

---

## 🔧 IMMEDIATE FIXES

### If Migration Not Run
```bash
# Open Supabase SQL Editor
# Paste contents of: supabase/migrations/20251231000000_checklist_docs_reconciliation.sql
# Click "Run"
```

---

### If Docs Have NULL `checklist_key`
**Option A**: Improve auto-match patterns in `src/lib/deals/autoMatchChecklistFromFilename.ts`

**Option B**: Manual update (temporary):
```sql
-- Example: Mark a doc as "IRS_BUSINESS_2Y"
update deal_documents
set checklist_key = 'IRS_BUSINESS_2Y'
where id = 'YOUR_DOC_ID';

-- Trigger will auto-fire and mark checklist item received!
```

**Option C**: Call reconciliation API:
```bash
curl -X POST "$PREVIEW_URL/api/deals/$DEAL_ID/checklist/reconcile" \
  -H "Cookie: YOUR_CLERK_COOKIE"
```

---

### If Using `borrower_uploads` Table
Not an issue with current code - all uploads go through `directDealDocumentUpload` which creates `deal_documents` rows.

---

## 🎯 PASTE THIS AND GET DIAGNOSIS

Run this in **Supabase SQL Editor** (replace `DEAL_ID`):

```sql
with checklist as (
  select
    c.checklist_key,
    c.title,
    c.required,
    c.status,
    c.received_at,
    c.received_document_id
  from deal_checklist_items c
  where c.deal_id = '373ccd15-619f-4af7-aaf1-6e5f6ed596df'
),
docs as (
  select
    checklist_key,
    count(*) as doc_count,
    array_agg(original_filename) as filenames
  from deal_documents
  where deal_id = '373ccd15-619f-4af7-aaf1-6e5f6ed596df'
  and checklist_key is not null
  group by checklist_key
),
files as (
  select
    checklist_key,
    count(*) as file_count
  from deal_files
  where deal_id = '373ccd15-619f-4af7-aaf1-6e5f6ed596df'
  and checklist_key is not null
  group by checklist_key
)
select
  c.checklist_key,
  c.title,
  c.required,
  c.status,
  c.received_at is not null as is_received,
  coalesce(d.doc_count, 0) as docs_count,
  coalesce(f.file_count, 0) as files_count,
  d.filenames as matching_docs,
  -- DIAGNOSIS
  case
    when c.received_at is not null and (coalesce(d.doc_count, 0) > 0 or coalesce(f.file_count, 0) > 0)
      then '✅ WORKING'
    when c.received_at is null and (coalesce(d.doc_count, 0) > 0 or coalesce(f.file_count, 0) > 0)
      then '❌ TRIGGER NOT FIRED (run migration)'
    when coalesce(d.doc_count, 0) = 0 and coalesce(f.file_count, 0) = 0
      then '⚠️ NO DOCS UPLOADED'
    else '❓ UNKNOWN STATE'
  end as diagnosis
from checklist c
left join docs d on c.checklist_key = d.checklist_key
left join files f on c.checklist_key = f.checklist_key
order by c.required desc, c.checklist_key;
```

**Paste the results and I'll tell you EXACTLY what to fix!**

---

## 📁 FILES SHIPPED

1. ✅ `supabase/migrations/20251231000000_checklist_docs_reconciliation.sql` - DB triggers
2. ✅ `src/app/api/deals/[dealId]/checklist/reconcile/route.ts` - Manual reconciliation
3. ✅ `src/app/api/deals/[dealId]/auto-seed/route.ts` - Auto reconciliation after seeding
4. ✅ `CHECKLIST_RECONCILIATION_COMPLETE.md` - Full documentation
5. ✅ `scripts/test-checklist-reconciliation.sh` - Test script

---

**Next**: Run the diagnostic query above and share results! 🚀
