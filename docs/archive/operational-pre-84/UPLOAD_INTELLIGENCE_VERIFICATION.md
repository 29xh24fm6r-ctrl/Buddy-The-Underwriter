# Upload Intelligence System - Complete Verification ✅

## System Architecture

```
Upload → Intelligence Runner → Extractions → Trigger → Snapshot Refresh
   ↓              ↓                 ↓            ↓            ↓
borrower_    run-upload-      borrower_      tr_refresh    deal_context_
uploads      intel.ts         upload_        _snapshot_    snapshots
                              extractions    ...           (auto-updated)
```

## Files Created

### ✅ 1. Database Migration
**[migrations/create_upload_extractions_trigger.sql](migrations/create_upload_extractions_trigger.sql)**
- Creates trigger on `borrower_upload_extractions`
- Uses existing function: `tg_refresh_snapshot_from_deal_id()`
- Includes backfill query (commented)

### ✅ 2. Core Intelligence Runner
**[src/lib/intel/run-upload-intel.ts](src/lib/intel/run-upload-intel.ts)**
- Main orchestration function
- Handles: fetch, download, OCR, classify, extract, persist
- Returns: `{ ok, uploadId, dealId, stored[], classifier }`

### ✅ 3. Bank Statement Extractor
**[src/lib/intel/extractors/bankStatements.ts](src/lib/intel/extractors/bankStatements.ts)**
- Example implementation (enhance with your logic)
- Extracts: fees, products, monthly pricing
- Returns confidence + evidence

### ✅ 4. Financial Statement Extractor
**[src/lib/intel/extractors/financialStatements.ts](src/lib/intel/extractors/financialStatements.ts)**
- Example implementation (enhance with your logic)
- Extracts: statement type, periods, key line items
- Returns confidence + evidence

### ✅ 5. API Endpoint
**[src/app/api/uploads/[uploadId]/intel/route.ts](src/app/api/uploads/[uploadId]/intel/route.ts)**
- POST `/api/uploads/{uploadId}/intel`
- Triggers intelligence extraction
- Returns JSON response

### ✅ 6. Test Script
**[test-upload-intel.sh](test-upload-intel.sh)**
- Automated test suite
- Queries database, shows examples
- Verifies trigger exists

### ✅ 7. Documentation
**[UPLOAD_INTELLIGENCE_SETUP.md](UPLOAD_INTELLIGENCE_SETUP.md)**
- Complete setup guide
- Testing instructions
- SQL verification queries

---

## Quick Start

### 1. Apply Migration
```bash
# Copy SQL to Supabase Dashboard and run, or:
psql "$DATABASE_URL" < migrations/create_upload_extractions_trigger.sql
```

### 2. Backfill (Optional)
```sql
select public.refresh_deal_context_snapshot(id) from public.deals;
```

### 3. Test
```bash
# Run test suite
./test-upload-intel.sh

# Or manually:
curl -X POST "http://localhost:3000/api/uploads/<UPLOAD_ID>/intel" | jq
```

### 4. Verify
```sql
-- Check extractions
select * from borrower_upload_extractions order by created_at desc limit 5;

-- Check snapshots refreshed
select deal_id, updated_at 
from deal_context_snapshots 
order by updated_at desc limit 5;

-- Check snapshot content
select 
  deal_id,
  jsonb_array_length(context->'borrower_upload_extractions') as count
from deal_context_snapshots 
where jsonb_array_length(context->'borrower_upload_extractions') > 0;
```

---

## Next Steps - Customize These Placeholders

All placeholder functions are clearly marked with `// TODO:` comments in the code.

### Priority 1: Wire Real Data Fetchers

**File**: [src/lib/intel/run-upload-intel.ts](src/lib/intel/run-upload-intel.ts)

1. **`getBorrowerUpload()`**
   - Verify column names match your schema
   - Example: `deal_id` vs `dealId`

2. **`downloadUploadBytes()`**
   - Verify bucket name: `"borrower-uploads"`
   - Verify `storage_path` column exists

3. **`tryLoadOcrJsonForUpload()`**
   - Query your OCR results table
   - Example:
   ```typescript
   const { data } = await sb
     .from("document_ocr_results")
     .select("raw")
     .eq("file_id", upload.id)
     .maybeSingle();
   return data?.raw || null;
   ```

### Priority 2: Enhance Extractors

**Files**: 
- [src/lib/intel/extractors/bankStatements.ts](src/lib/intel/extractors/bankStatements.ts)
- [src/lib/intel/extractors/financialStatements.ts](src/lib/intel/extractors/financialStatements.ts)

Current implementations are **example-only** with:
- Simple regex patterns
- Basic confidence scoring
- Placeholder evidence

**Your turn:**
- Add robust pattern matching
- Extract actual table data
- Calculate real confidence scores
- Capture precise evidence offsets

### Priority 3: Add More Extractors

Create additional extractors as needed:
- `src/lib/intel/extractors/taxReturns.ts`
- `src/lib/intel/extractors/leases.ts`
- `src/lib/intel/extractors/invoices.ts`

Pattern:
```typescript
export function extractTaxReturns(tokens: string) {
  // Your logic
  return {
    kind: "TAX_RETURNS",
    confidence: 0.8,
    fields: { /* your extracted data */ },
    tables: [],
    evidence: [],
  };
}
```

---

## How It Works

### 1. You Call the Endpoint
```bash
POST /api/uploads/{uploadId}/intel
```

### 2. Runner Orchestrates
- Fetches upload from database
- Downloads file bytes
- Loads OCR (if available)
- Runs extractors
- Filters by confidence (≥0.4)

### 3. Writes to Database
```sql
INSERT INTO borrower_upload_extractions (
  upload_id,
  deal_id,
  kind,
  fields,
  tables,
  evidence
) VALUES (...)
```

### 4. Trigger Fires Automatically
```sql
-- This happens automatically!
CREATE TRIGGER tr_refresh_snapshot_upload_extractions
AFTER INSERT OR UPDATE OR DELETE ON borrower_upload_extractions
FOR EACH ROW EXECUTE FUNCTION tg_refresh_snapshot_from_deal_id();
```

### 5. Snapshot Refreshes
- `deal_context_snapshots.context` now contains:
  - `borrower_upload_extractions[]`
  - All your extracted intelligence
  - Fully sourced with evidence

### 6. Memo Agent Reads One Blob
```typescript
const snapshot = await getSnapshot(dealId);
const extractions = snapshot.context.borrower_upload_extractions;
// Write memo using structured data
```

---

## Schema Reference

### borrower_upload_extractions

```sql
CREATE TABLE borrower_upload_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID REFERENCES borrower_uploads(id),
  deal_id UUID REFERENCES deals(id),
  kind TEXT NOT NULL,              -- "BANK_STATEMENTS", "FINANCIAL_STATEMENTS", etc.
  fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  tables JSONB[] DEFAULT '{}',
  evidence JSONB[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Fields Examples

**BANK_STATEMENTS:**
```json
{
  "fees_detected": [
    { "name": "Monthly Maintenance Fee", "amount": 15.00, "evidence": "..." }
  ],
  "products_detected": ["Checking Account", "Savings Account"],
  "monthly_pricing": 15.00,
  "classifier": { "doc_type": "BANK_STATEMENT", "confidence": 0.7 },
  "ocrUsed": true
}
```

**FINANCIAL_STATEMENTS:**
```json
{
  "statement_type": "Balance Sheet",
  "periods": [2023, 2022],
  "key_items": [
    { "label": "Total Assets", "values": [500000] }
  ],
  "multi_period": true,
  "classifier": { "doc_type": "FINANCIAL_STATEMENT", "confidence": 0.85 },
  "ocrUsed": true
}
```

---

## Troubleshooting

### Trigger not firing?
```sql
-- Check if trigger exists
SELECT tgname, tgrelid::regclass 
FROM pg_trigger 
WHERE tgname = 'tr_refresh_snapshot_upload_extractions';

-- Recreate if needed
DROP TRIGGER IF EXISTS tr_refresh_snapshot_upload_extractions 
  ON borrower_upload_extractions;
CREATE TRIGGER tr_refresh_snapshot_upload_extractions
  AFTER INSERT OR UPDATE OR DELETE ON borrower_upload_extractions
  FOR EACH ROW EXECUTE FUNCTION tg_refresh_snapshot_from_deal_id();
```

### No extractions being created?
- Check confidence threshold (currently ≥0.4)
- Add logging to see extractor results
- Verify tokens are being extracted properly

### Snapshots not updating?
- Verify `tg_refresh_snapshot_from_deal_id()` function exists
- Check for errors in Postgres logs
- Test function manually:
```sql
SELECT refresh_deal_context_snapshot('<DEAL_ID>');
```

### API returning 500?
- Check server logs
- Verify `borrower_uploads` table exists
- Verify Supabase storage is configured
- Check `deal_id` column exists on uploads

---

## Success Criteria

✅ **Setup Complete When:**
1. Trigger exists and fires on write
2. Test upload returns `{ ok: true }`
3. Extractions appear in database
4. Snapshots auto-update
5. Snapshot JSON contains extraction data

✅ **Production Ready When:**
1. All placeholder functions replaced
2. Extractors return real data
3. Confidence scores are accurate
4. Evidence is properly sourced
5. Auto-trigger on upload (optional)

---

## File Tree

```
Buddy-The-Underwriter/
├── migrations/
│   └── create_upload_extractions_trigger.sql       ← Run this first
├── src/
│   ├── app/
│   │   └── api/
│   │       └── uploads/
│   │           └── [uploadId]/
│   │               └── intel/
│   │                   └── route.ts                ← API endpoint
│   └── lib/
│       └── intel/
│           ├── run-upload-intel.ts                 ← Main runner
│           └── extractors/
│               ├── bankStatements.ts               ← Option 1
│               └── financialStatements.ts          ← Option 2
├── test-upload-intel.sh                            ← Test suite
├── UPLOAD_INTELLIGENCE_SETUP.md                    ← Setup guide
└── UPLOAD_INTELLIGENCE_VERIFICATION.md             ← This file
```

---

## Support

If you need help:
1. Check [UPLOAD_INTELLIGENCE_SETUP.md](UPLOAD_INTELLIGENCE_SETUP.md) for detailed instructions
2. Run `./test-upload-intel.sh` to verify setup
3. Check SQL queries in this file for debugging

**Share this to debug:**
- One row from `borrower_uploads` (sanitized)
- Your storage bucket configuration
- Any error messages from API calls
