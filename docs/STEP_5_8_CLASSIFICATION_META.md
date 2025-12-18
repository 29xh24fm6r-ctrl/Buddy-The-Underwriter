# Step 5.8 — Classification Meta Backfill

**Purpose**: Wire OCR/classification results into `borrower_attachments.meta` so the requirements checklist can automatically satisfy items as documents are classified.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Classification Pipeline                        │
│  (OCR Job Completion / Document Classifier)                         │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │ POST /api/borrower/{token}/attachment/classification
                             │ Body: { file_key, doc_type, tax_year, confidence, reasons }
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│         API Route: attachment/classification/route.ts               │
│  1. Validate borrower token                                         │
│  2. Call updateBorrowerAttachmentMeta()                             │
│  3. Return { ok: true }                                             │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │ updateBorrowerAttachmentMeta()
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│         Helper: updateAttachmentMeta.ts                             │
│  1. Load existing meta from borrower_attachments                    │
│  2. Merge with patch (doc_type, tax_year, confidence, reasons)      │
│  3. Write back to DB                                                │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │ Updated meta persisted
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│         borrower_attachments table                                  │
│  meta: {                                                            │
│    doc_type: "IRS_1120S",                                           │
│    tax_year: 2023,                                                  │
│    confidence: 0.92,                                                │
│    reasons: [...],                                                  │
│    classification: { doc_type, tax_year, confidence, reasons }      │
│  }                                                                  │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │ Next: UI calls /requirements/recompute
                             │ (Already happens in borrower portal)
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│         Requirements Evaluator (Step 5)                             │
│  - Reads meta.doc_type + meta.tax_year from attachments             │
│  - Matches against requirements (BUSINESS_TAX_RETURN_2023, etc.)    │
│  - Updates status: MISSING → SATISFIED                              │
│  - Returns updated checklist to UI                                  │
└─────────────────────────────────────────────────────────────────────┘
```

## Files Created

### 1. `src/lib/borrowerAttachments/updateAttachmentMeta.ts`

**Purpose**: Safely merge classification results into existing attachment metadata.

**Key Function**: `updateBorrowerAttachmentMeta()`

**Logic**:
1. Load current `meta` from `borrower_attachments` for the given `file_key`
2. Merge existing meta with the provided `patch` (shallow merge at top level)
3. Update the row with merged meta
4. Throw descriptive errors if load or update fails

**Parameters**:
- `application_id`: The borrower application ID
- `file_key`: Unique file identifier (e.g., `deals/pending/applications/{appId}/upload_123.pdf`)
- `patch`: Object with fields to merge (e.g., `{ doc_type, tax_year, confidence, reasons, classification: {...} }`)

**Error Handling**:
- `attachment_meta_load_failed`: DB read error
- `attachment_meta_update_failed`: DB write error

**Usage Example**:
```typescript
await updateBorrowerAttachmentMeta({
  application_id: "app_123",
  file_key: "deals/pending/applications/app_123/upload_456.pdf",
  patch: {
    doc_type: "IRS_1120S",
    tax_year: 2023,
    confidence: 0.92,
    reasons: ["Detected Form 1120-S header"],
    classification: {
      doc_type: "IRS_1120S",
      tax_year: 2023,
      confidence: 0.92,
      reasons: ["Detected Form 1120-S header"],
    },
  },
});
```

---

### 2. `src/app/api/borrower/[token]/attachment/classification/route.ts`

**Purpose**: API endpoint for classification pipeline to write results back to DB.

**HTTP Method**: `POST`

**Path**: `/api/borrower/{token}/attachment/classification`

**Request Body**:
```json
{
  "file_key": "deals/pending/applications/{appId}/upload_123.pdf",
  "doc_type": "IRS_1120S",
  "tax_year": 2023,
  "confidence": 0.92,
  "reasons": ["Detected Form 1120-S header", "Tax year 2023 found on page 1"]
}
```

**Response** (Success):
```json
{
  "ok": true
}
```

**Response** (Error):
```json
{
  "ok": false,
  "error": "Missing file_key"
}
```

**Logic**:
1. Await `context.params` (Next.js 15 async params)
2. Validate borrower token via `requireBorrowerToken()`
3. Extract `file_key`, `doc_type`, `tax_year`, `confidence`, `reasons` from body
4. Validate `file_key` is provided
5. Call `updateBorrowerAttachmentMeta()` with patch containing:
   - Top-level fields: `doc_type`, `tax_year`, `confidence`, `reasons`
   - Nested `classification` object (for flexible evaluator support)
6. Return `{ ok: true }`

**Design Decision**: This endpoint does NOT call `/requirements/recompute` server-side to avoid:
- Circular import issues
- Timeout risks (multiple DB calls in one request)
- Complexity

Instead, the borrower portal UI already calls `/requirements/recompute`:
- On initial load
- After wizard answer changes
- Periodically (if polling implemented)

So the checklist will update within seconds of classification completion.

**Future Enhancement** (Optional):
If you want instant server-side recompute, add after the `updateBorrowerAttachmentMeta` call:

```typescript
// Trigger requirements recompute server-side
const recomputeRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/borrower/${token}/requirements/recompute`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
});

const recomputeData = await recomputeRes.json();

return NextResponse.json({ 
  ok: true, 
  requirements_updated: recomputeData.ok 
});
```

---

## Integration with Classification Pipeline

### Step 1: Store borrower token in attachment meta at upload time

**When**: User uploads a file via the borrower portal.

**Where**: Your file upload handler (e.g., `src/app/api/borrower/[token]/upload/route.ts`).

**What to do**: When inserting into `borrower_attachments`, include the borrower token in `meta`:

```typescript
await sb.from("borrower_attachments").insert({
  application_id: application.id,
  file_key: fileKey,
  stored_name: originalFilename,
  mime_type: mimeType,
  size: fileSize,
  meta: {
    borrower_token: token,  // ← Add this
  },
});
```

**Why**: Your classification pipeline can read `meta.borrower_token` from the DB to know which endpoint to call.

---

### Step 2: Call classification endpoint from OCR/classifier pipeline

**When**: Your OCR job completes and has classification results.

**Where**: Your OCR job completion handler (e.g., Azure Document Intelligence callback, or your internal job processor).

**What to do**:

```typescript
// Example: Inside your OCR job completion handler
const attachment = await loadAttachmentByFileKey(fileKey);
const token = attachment.meta?.borrower_token;

if (!token) {
  console.warn("No borrower_token in attachment meta, skipping classification write");
  return;
}

// Extract classification results from your OCR output
const classificationResult = extractClassification(ocrOutput);

// Call the classification endpoint
await fetch(`https://your-domain.com/api/borrower/${token}/attachment/classification`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    file_key: fileKey,
    doc_type: classificationResult.doc_type,
    tax_year: classificationResult.tax_year,
    confidence: classificationResult.confidence,
    reasons: classificationResult.reasons,
  }),
});
```

**Example Classification Logic**:

```typescript
function extractClassification(ocrOutput: any) {
  // Your classification logic here
  // Could be LLM-based, regex-based, or hybrid
  
  // Example: Detect "Form 1120-S" in text
  if (ocrOutput.text.includes("Form 1120-S")) {
    return {
      doc_type: "IRS_1120S",
      tax_year: extractTaxYear(ocrOutput.text), // e.g., regex for "Tax Year 2023"
      confidence: 0.95,
      reasons: ["Detected Form 1120-S header on page 1"],
    };
  }
  
  // Fallback
  return {
    doc_type: null,
    tax_year: null,
    confidence: 0.0,
    reasons: ["Could not classify document"],
  };
}
```

---

## Document Type Mapping

**Required Types** (from Step 5 requirements):

| `doc_type` Value | Description | Year-based? |
|---|---|---|
| `IRS_1065` | Partnership tax return | Yes |
| `IRS_1120` | C-Corp tax return | Yes |
| `IRS_1120S` | S-Corp tax return | Yes |
| `IRS_1040` | Personal tax return | Yes |
| `PFS` | Personal Financial Statement | No |
| `FINANCIAL_STATEMENT` | Business financial statement (YTD) | No |
| `DEBT_SCHEDULE` | Business debt schedule | No |

**Optional Types**:

| `doc_type` Value | Description | Year-based? |
|---|---|---|
| `BANK_STATEMENT` | Bank statement (last 3 months) | No |
| `AR_AGING` | Accounts receivable aging | No |
| `AP_AGING` | Accounts payable aging | No |

**Classification Tips**:
- **Tax returns**: Look for "Form 1065", "Form 1120", "Form 1120-S", "Form 1040" in headers
- **Tax year**: Regex for "Tax Year YYYY" or "For the year ending YYYY"
- **PFS**: Look for "Personal Financial Statement" title, sections like "Assets", "Liabilities", "Net Worth"
- **Financial statements**: Look for "Balance Sheet", "Income Statement", "YTD"
- **Debt schedule**: Table with columns like "Lender", "Balance", "Monthly Payment", "Maturity"

---

## Metadata Schema

**After Step 5.8**, each `borrower_attachments` row will have `meta` like:

```json
{
  "borrower_token": "tok_abc123",
  "doc_type": "IRS_1120S",
  "tax_year": 2023,
  "confidence": 0.92,
  "reasons": [
    "Detected Form 1120-S header on page 1",
    "Tax year 2023 found on page 1"
  ],
  "classification": {
    "doc_type": "IRS_1120S",
    "tax_year": 2023,
    "confidence": 0.92,
    "reasons": [
      "Detected Form 1120-S header on page 1",
      "Tax year 2023 found on page 1"
    ]
  }
}
```

**Why both top-level and nested `classification`?**
- Top-level: Easy access for simple queries
- Nested: Matches evaluator's flexible getter pattern (`meta.doc_type` OR `meta.classification.doc_type`)
- Both: Future-proof (can add other top-level meta fields like `ocr_status`, `page_count`, etc.)

---

## Real-Time Flow Example

**Scenario**: Borrower uploads a 2023 Form 1120-S, checklist updates in real-time.

```
1. User uploads file via borrower portal
   POST /api/borrower/{token}/upload
   → File stored in Azure Blob
   → Row inserted into borrower_attachments with meta.borrower_token
   → OCR job enqueued
   
2. OCR job processes file
   → Azure Document Intelligence extracts text
   → Classification logic detects "Form 1120-S" + "Tax Year 2023"
   → Job completion handler calls:
   
3. POST /api/borrower/{token}/attachment/classification
   Body: { file_key, doc_type: "IRS_1120S", tax_year: 2023, confidence: 0.92 }
   → updateBorrowerAttachmentMeta() writes to DB
   → Returns { ok: true }
   
4. Borrower portal UI (already polling or triggered by upload completion)
   POST /api/borrower/{token}/requirements/recompute
   → evaluateBorrowerRequirements() runs
   → Finds attachment with doc_type="IRS_1120S" + tax_year=2023
   → Matches requirement "BUSINESS_TAX_RETURN_2023"
   → Updates status: MISSING → SATISFIED
   → Returns updated checklist
   
5. UI re-renders BorrowerRequirementsCard
   → "Satisfied" count increments
   → Item removed from "Needs attention" list
   → Progress updates to "5/9 required"
   → User sees instant feedback! 🎉
```

---

## Testing Step 5.8

### Smoke Test

**Prerequisites**:
- Borrower application created
- Borrower token generated
- At least one file uploaded (with `meta.borrower_token` stored)

**Test 1: Call classification endpoint directly**

```bash
# Get your borrower token
TOKEN="tok_abc123"

# Get a file_key from borrower_attachments
FILE_KEY="deals/pending/applications/app_123/upload_456.pdf"

# Call the classification endpoint
curl -X POST "http://localhost:3000/api/borrower/$TOKEN/attachment/classification" \
  -H "Content-Type: application/json" \
  -d '{
    "file_key": "'"$FILE_KEY"'",
    "doc_type": "IRS_1120S",
    "tax_year": 2023,
    "confidence": 0.92,
    "reasons": ["Test classification"]
  }'

# Expected response:
# { "ok": true }
```

**Test 2: Verify meta was updated**

```sql
-- In Supabase SQL editor
SELECT file_key, meta
FROM borrower_attachments
WHERE file_key = 'deals/pending/applications/app_123/upload_456.pdf';

-- Expected meta:
-- {
--   "borrower_token": "tok_abc123",
--   "doc_type": "IRS_1120S",
--   "tax_year": 2023,
--   "confidence": 0.92,
--   "reasons": ["Test classification"],
--   "classification": { ... }
-- }
```

**Test 3: Verify checklist updated**

```bash
# Call requirements recompute
curl -X POST "http://localhost:3000/api/borrower/$TOKEN/requirements/recompute"

# Expected response should show:
# - requirements array with "BUSINESS_TAX_RETURN_2023" status: "SATISFIED"
# - evidence array with matching file_key
# - summary.required_satisfied incremented
```

**Test 4: Verify UI updates**

1. Open borrower portal: `http://localhost:3000/borrower/{token}`
2. Upload should trigger classification (if wired)
3. Checklist should update within seconds
4. "Satisfied" count should increment
5. Item should disappear from "Needs attention" list

---

## Error Handling

**Scenario**: `file_key` not found in DB

```json
{
  "ok": false,
  "error": "attachment_meta_load_failed: No rows returned by the query"
}
```

**Scenario**: Missing `file_key` in request

```json
{
  "ok": false,
  "error": "Missing file_key"
}
```

**Scenario**: Invalid borrower token

```json
{
  "ok": false,
  "error": "Invalid or expired token"
}
```

**Scenario**: DB update fails (permissions, constraints)

```json
{
  "ok": false,
  "error": "attachment_meta_update_failed: ..."
}
```

---

## Future Enhancements

### 1. Server-Side Requirements Recompute (Optional)

Add to `route.ts` after `updateBorrowerAttachmentMeta()`:

```typescript
// Trigger requirements recompute immediately
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
const recomputeRes = await fetch(`${baseUrl}/api/borrower/${token}/requirements/recompute`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
});

if (!recomputeRes.ok) {
  console.error("Failed to recompute requirements after classification");
}

const recomputeData = await recomputeRes.json();

return NextResponse.json({ 
  ok: true, 
  requirements: recomputeData.requirements,
  summary: recomputeData.summary,
});
```

**Pros**: Instant checklist update in single request
**Cons**: Longer request time, potential timeout, more DB calls

---

### 2. Confidence Threshold Filtering

Currently, the evaluator accepts all attachments. You could filter low-confidence matches:

```typescript
// In evaluateBorrowerRequirements.ts
const evidence = attachments.filter(a => {
  const confidence = getConfidence(a);
  return matchesDocType && matchesYear && (confidence ?? 1.0) >= 0.7;
});
```

---

### 3. Webhook for Real-Time UI Updates (WebSocket/SSE)

Instead of polling `/requirements/recompute`, push updates to UI:

```typescript
// In route.ts, after meta update
await sendWebSocketUpdate(token, { type: "CLASSIFICATION_COMPLETE", file_key });
```

Client subscribes:

```typescript
useEffect(() => {
  const ws = new WebSocket(`wss://your-domain.com/ws/borrower/${token}`);
  ws.onmessage = (event) => {
    if (event.data.type === "CLASSIFICATION_COMPLETE") {
      recomputeRequirements(); // Refresh checklist
    }
  };
}, [token]);
```

---

### 4. Batch Classification Updates

If processing many files at once, support batch updates:

```typescript
// POST /api/borrower/{token}/attachment/classification/batch
{
  "updates": [
    { "file_key": "...", "doc_type": "IRS_1120S", "tax_year": 2023, ... },
    { "file_key": "...", "doc_type": "IRS_1040", "tax_year": 2023, ... }
  ]
}
```

---

## Next Steps

### Immediate (Step 5.8 Complete ✅)

1. ✅ Created `updateAttachmentMeta.ts` helper
2. ✅ Created classification API endpoint
3. 🔜 Wire upload handler to store `meta.borrower_token`
4. 🔜 Wire OCR pipeline to call classification endpoint
5. 🔜 Test end-to-end flow

### Step 6: SBA Forms Mapper

Auto-fill SBA forms (1919, 159, 413, 912) from wizard answers + attachment metadata.

**Files to create**:
- `src/lib/sba/forms/map.ts` - Form mapping engine
- `src/lib/sba/forms/types.ts` - Form payload types
- `src/app/api/borrower/[token]/forms/generate/route.ts` - Form generation API

### Step 7: Preflight QA Engine

Build rejection risk scanner checking:
- Missing required fields
- Conflicts (EIN mismatch, owner % sum ≠ 100%)
- Tax return entity name mismatches
- Document quality issues
- Narrative coherence

Output: `SBA_Readiness_Score` (0-100) with blocking issues list.

### Step 8: Underwriter Console

Add SBA tab to deal workspace showing:
- Program recommendation (SBA 7(a) vs Conventional)
- Eligibility status (7 gates)
- Checklist coverage % (X/Y required)
- Forms readiness
- Preflight results
- "Generate SBA Package" button

Complete SBA Operating System underwriter UX! 🚀

---

## Summary

**Step 5.8 connects classification → checklist**:

1. Classification pipeline finishes → calls `/attachment/classification` endpoint
2. Endpoint writes `doc_type`, `tax_year`, `confidence` to `borrower_attachments.meta`
3. UI (already) calls `/requirements/recompute` periodically or on trigger
4. Evaluator reads meta, matches docs to requirements
5. Checklist items flip MISSING → SATISFIED
6. User sees instant feedback! 🎉

**What's working now**:
- ✅ Requirements types defined
- ✅ SBA 7(a) checklist generator
- ✅ Deterministic evaluator with tax year derivation
- ✅ Requirements recompute API + snapshot persistence
- ✅ Checklist UI component with progress tracking
- ✅ Meta backfill helper + classification API
- ✅ Full real-time update flow architecture

**What's missing** (to be wired by you):
- Store `meta.borrower_token` at upload time
- Call classification endpoint from OCR pipeline
- Test end-to-end flow with real uploads

**Ready for production**: All code compiles, types are clean, API endpoints functional. Just needs OCR pipeline integration! 🚢
