# Upload Intelligence System - Setup Complete ✅

## What's Been Created

### 1. Database Trigger (Migration)
**File**: [migrations/create_upload_extractions_trigger.sql](migrations/create_upload_extractions_trigger.sql)

- Creates trigger `tr_refresh_snapshot_upload_extractions` on `borrower_upload_extractions`
- Uses existing function: `tg_refresh_snapshot_from_deal_id()`
- Auto-refreshes `deal_context_snapshots` on INSERT/UPDATE/DELETE

### 2. Upload Intelligence Runner
**File**: [src/lib/intel/run-upload-intel.ts](src/lib/intel/run-upload-intel.ts)

Core engine that:
- Fetches upload from database
- Downloads file bytes from storage
- Loads OCR if available (Azure DI)
- Classifies document type
- Runs extractors (bank statements + financial statements)
- Writes to `borrower_upload_extractions`

### 3. API Endpoint
**File**: [src/app/api/uploads/[uploadId]/intel/route.ts](src/app/api/uploads/[uploadId]/intel/route.ts)

- **POST** `/api/uploads/{uploadId}/intel`
- Triggers intelligence extraction for a single upload

---

## Setup Instructions

### 1. Run the Database Migration

Apply the trigger (choose one method):

**Option A: Direct SQL (if you have psql)**
```bash
psql "$DATABASE_URL" < migrations/create_upload_extractions_trigger.sql
```

**Option B: Supabase Dashboard**
1. Open Supabase SQL Editor
2. Paste contents of `migrations/create_upload_extractions_trigger.sql`
3. Run

**Option C: Your migration tool**
```bash
# If using Supabase CLI
supabase db push

# If using custom migration runner
npm run db:migrate
```

### 2. One-Time Backfill (Optional)

Refresh all existing snapshots:

```sql
select public.refresh_deal_context_snapshot(id) from public.deals;
```

---

## Testing

### 1. Get a Test Upload ID

```sql
select id, deal_id, original_filename, storage_path
from public.borrower_uploads
order by created_at desc
limit 10;
```

### 2. Trigger Intelligence Extraction

```bash
curl -s -X POST "http://localhost:3000/api/uploads/<UPLOAD_UUID>/intel" | jq
```

**Expected Response:**
```json
{
  "ok": true,
  "uploadId": "...",
  "dealId": "...",
  "stored": ["BANK_STATEMENTS", "FINANCIAL_STATEMENTS"],
  "classifier": {
    "doc_type": "BANK_STATEMENT",
    "confidence": 0.7
  }
}
```

### 3. Verify Extractions Inserted

```sql
select deal_id, upload_id, kind, created_at
from public.borrower_upload_extractions
order by created_at desc
limit 20;
```

### 4. Verify Snapshots Auto-Refreshed

```sql
select deal_id, updated_at, version
from public.deal_context_snapshots
order by updated_at desc
limit 10;
```

### 5. Verify Snapshot Contains Extractions

```sql
select
  deal_id,
  jsonb_array_length(context->'borrower_upload_extractions') as extraction_count,
  context->'borrower_upload_extractions'->0->>'kind' as first_extraction_kind
from public.deal_context_snapshots
where jsonb_array_length(context->'borrower_upload_extractions') > 0
order by updated_at desc
limit 10;
```

---

## Implementation Status

✅ **Done:**
- Trigger creation (using existing function)
- Core runner framework
- API endpoint
- Placeholder extractors

⚠️ **TODO (Implement Your Logic):**

The following functions in [src/lib/intel/run-upload-intel.ts](src/lib/intel/run-upload-intel.ts) are **placeholders**:

1. **`getBorrowerUpload()`** - Currently queries `borrower_uploads` table
   - May need to adjust column names to match your schema

2. **`downloadUploadBytes()`** - Currently uses Supabase Storage
   - Verify `storage_bucket` and `storage_path` column names

3. **`tryLoadOcrJsonForUpload()`** - Currently returns `null`
   - Wire to your `document_ocr_results` table or similar
   - Load the Azure DI JSON blob

4. **`azureToTokens()`** - Basic extraction
   - Improve to extract from `analyzeResult.content` or similar

5. **`nativePdfToTokens()`** - Currently returns empty string
   - Optionally add `pdf-parse` for non-OCR PDFs

6. **`classifyFromTokens()`** - Simple keyword matching
   - Replace with your existing classifier or enhance

7. **`extractBankFeesProducts()`** - Returns placeholder data
   - **This is Option 1** - Implement your bank statement logic

8. **`extractFinancialStatements()`** - Returns placeholder data
   - **This is Option 2** - Implement your financial statement logic

---

## Next Steps

1. **Run migration** to create the trigger
2. **Enhance placeholders** with your actual extraction logic
3. **Test** on real uploads
4. **Wire to auto-run** on upload (optional):
   ```typescript
   // In your upload handler:
   await fetch(`/api/uploads/${uploadId}/intel`, { method: "POST" });
   ```

---

## What This Unlocks

Once extractors are implemented and wired:

**Automatic Intelligence Extraction:**
- Upload → OCR → Classification → Extraction → Snapshot refresh
- All triggered automatically on write to `borrower_upload_extractions`

**Memo Agent Ready:**
- `deal_context_snapshots.context` contains:
  - `borrower_upload_extractions[]` with structured data
  - Bank fees, products, monthly pricing
  - Multi-period financial statements
  - All sourced with evidence

**One-Read Access:**
- Buddy's memo agent reads **one JSON blob**
- No N+1 queries
- No stale data
- Fully sourced

---

## File Paths Reference

- Migration: [migrations/create_upload_extractions_trigger.sql](migrations/create_upload_extractions_trigger.sql)
- Runner: [src/lib/intel/run-upload-intel.ts](src/lib/intel/run-upload-intel.ts)
- API: [src/app/api/uploads/[uploadId]/intel/route.ts](src/app/api/uploads/[uploadId]/intel/route.ts)
- This README: [UPLOAD_INTELLIGENCE_SETUP.md](UPLOAD_INTELLIGENCE_SETUP.md)
