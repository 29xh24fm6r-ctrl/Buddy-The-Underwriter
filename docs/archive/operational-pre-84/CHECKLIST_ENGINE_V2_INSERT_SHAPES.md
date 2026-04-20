# INSERT SHAPES - ALL 4 DEAL_DOCUMENTS WRITERS

This document shows the exact INSERT payloads for all 4 canonical `deal_documents` writers.

---

## Writer #1: `src/app/api/deals/[dealId]/files/record/route.ts`

**Context:** Banker-side upload after signed URL  
**Auth:** Clerk user  
**Source:** `"internal"`

### INSERT Payload
```typescript
await sb.from("deal_documents").insert({
  id: file_id,                    // UUID from client
  deal_id: dealId,                // From URL params
  bank_id: deal.bank_id,          // Inherited from deal
  
  // Storage (Supabase Storage)
  storage_bucket: "deal-files",
  storage_path: object_path,      // e.g. "deals/abc-123/file.pdf"
  
  // File metadata
  original_filename,              // From client
  mime_type: mime_type ?? "application/octet-stream",
  size_bytes: size_bytes ?? 0,
  
  // Business keys
  document_key: checklist_key ?? "UNCLASSIFIED",  // Legacy field
  checklist_key: checklist_key ?? null,            // NEW: Can be null
  
  // JSON columns (NOT NULL)
  extracted_fields: {},
  metadata: {},
  
  // Upload tracking
  source: "internal",             // Banker upload
  uploader_user_id: userId,       // Clerk user ID
}).select("id, checklist_key, original_filename").single();
```

### Post-Insert Actions
```typescript
// 🔥 Engine v2: Stamp checklist_key + doc_year
await matchAndStampDealDocument({
  sb,
  dealId,
  documentId: inserted.id,
  originalFilename: inserted.original_filename ?? null,
  mimeType: inserted.mime_type ?? null,
  extractedFields: {},
  metadata: {},
});

// 🔥 Reconcile checklist (year-aware satisfaction)
await reconcileChecklistForDeal({ sb, dealId });
```

**Result:** Document stamped with `checklist_key`, `doc_year`, `match_confidence`, `match_reason`, `match_source`

---

## Writer #2: `src/app/api/portal/[token]/files/record/route.ts`

**Context:** Borrower portal upload after signed URL  
**Auth:** Portal invite token  
**Source:** `"borrower"`

### INSERT Payload
```typescript
const { data: inserted } = await sb.from("deal_documents").insert({
  id: file_id,                    // UUID from client
  deal_id: dealId,                // From portal invite
  bank_id: deal.bank_id,          // Inherited from deal
  
  // Storage (Supabase Storage)
  storage_bucket: "deal-files",
  storage_path: object_path,      // e.g. "deals/abc-123/borrower/file.pdf"
  
  // File metadata
  original_filename,              // From client
  mime_type: mime_type ?? "application/octet-stream",
  size_bytes: size_bytes ?? 0,
  
  // Business keys
  document_key: checklist_key ?? "UNCLASSIFIED",  // Legacy field
  checklist_key: checklist_key ?? null,            // NEW: Can be null
  
  // JSON columns (NOT NULL)
  extracted_fields: {},
  metadata: {},
  
  // Upload tracking
  source: "borrower",             // Borrower upload
  uploader_user_id: null,         // No Clerk user
}).select("*").single();
```

### Post-Insert Actions
```typescript
// 🔥 Engine v2: Stamp checklist_key + doc_year
await matchAndStampDealDocument({
  sb,
  dealId,
  documentId: inserted.id,
  originalFilename: inserted.original_filename ?? null,
  mimeType: inserted.mime_type ?? null,
  extractedFields: inserted.extracted_fields,
  metadata: inserted.metadata,
});

// 🔥 Reconcile checklist
await reconcileChecklistForDeal({ sb, dealId });
```

**Result:** Identical stamping to banker path - borrower uploads now light up checklist! ✅

---

## Writer #3: `src/app/api/portal/upload/commit/route.ts`

**Context:** Borrower portal multipart upload commit  
**Auth:** Portal invite token  
**Architecture:** Inserts into `borrower_uploads`, which triggers `deal_documents` insert

### INSERT Payload (borrower_uploads)
```typescript
const { data: upload } = await sb.from("borrower_uploads").insert({
  deal_id: invite.deal_id,
  bank_id: invite.bank_id,
  request_id: requestId,          // Optional: linked to document request
  storage_bucket: "borrower_uploads",
  storage_path: path,             // e.g. "temp/abc-123/file.pdf"
  original_filename: filename,
  mime_type: mimeType,
  size_bytes: sizeBytes,
}).select("id").single();
```

**Note:** `deal_documents` record created by DB trigger (has FK `deal_document_id`)

### Post-Insert Actions
```typescript
// Look up linked deal_document
const { data: doc } = await sb
  .from("borrower_uploads")
  .select("deal_document_id")
  .eq("id", upload.id)
  .single();

if (doc?.deal_document_id) {
  // 🔥 Engine v2: Stamp the deal_document
  await matchAndStampDealDocument({
    sb,
    dealId: invite.deal_id,
    documentId: doc.deal_document_id,
    originalFilename: filename,
    mimeType: mimeType,
    extractedFields: {},
    metadata: {},
  });

  // 🔥 Reconcile checklist
  await reconcileChecklistForDeal({ sb, dealId: invite.deal_id });
}
```

**Result:** Multipart upload path also stamps + reconciles

---

## Writer #4: `src/app/api/public/upload/route.ts`

**Context:** Link-based batch upload (no auth, just link password)  
**Auth:** Link password check  
**Source:** `"borrower"`  
**Batching:** Processes multiple files in loop, reconciles once at end

### INSERT Payload (per file in loop)
```typescript
const { data: docRow } = await supabaseAdmin()
  .from("deal_documents")
  .insert({
    deal_id: dealId,                      // From link
    storage_bucket: bucket,               // "deal-files"
    storage_path: storagePath,            // Generated: deals/{dealId}/borrower/{ts}_{rand}_{filename}
    
    // File metadata
    original_filename: f.name || "upload",
    mime_type: f.type || null,
    size_bytes: bytes.length,
    
    // Upload tracking
    uploader_user_id: null,               // No Clerk user
    uploaded_via_link_id: link.id,        // Link UUID
    source: "borrower",
    
    // Optional: client-provided checklist_key
    checklist_key: checklistKey || null,
    
    // SHA256 hash for deduplication
    sha256: sha256(bytes.toString("hex")),
  })
  .select("id")
  .single();
```

### Post-Insert Actions (per file)
```typescript
// 🔥 Engine v2: Stamp each file as uploaded
await matchAndStampDealDocument({
  sb: supabaseAdmin(),
  dealId,
  documentId: docRow.id,
  originalFilename: f.name || "upload",
  mimeType: f.type || null,
  extractedFields: {},
  metadata: {},
});
```

### After All Files (once)
```typescript
// 🔥 Reconcile once after batch
if (successCount > 0) {
  try {
    await reconcileChecklistForDeal({ sb: supabaseAdmin(), dealId });
  } catch (e) {
    console.error("Reconcile failed (non-blocking):", e);
  }
}
```

**Result:** Batch upload stamping + single reconcile (efficient!)

---

## Common Columns (All Writers)

### Always Present
- `id` - UUID (client-generated or server-generated)
- `deal_id` - UUID (from context)
- `bank_id` - UUID (inherited from deal, for RLS)
- `storage_bucket` - Text (`"deal-files"` or `"borrower_uploads"`)
- `storage_path` - Text (unique path in bucket)
- `original_filename` - Text
- `source` - Text (`"internal"`, `"borrower"`)

### Often Present
- `mime_type` - Text (from upload, nullable)
- `size_bytes` - Bigint (from upload, nullable)
- `checklist_key` - Text (nullable, stamped post-insert)
- `document_key` - Text (legacy, defaults to `"UNCLASSIFIED"`)

### Engine-Stamped (Post-Insert)
- `checklist_key` - Text (`"IRS_BUSINESS_2Y"`, `"PFS_CURRENT"`, etc.)
- `doc_year` - Integer (`2024`, `2023`, etc. or NULL)
- `match_confidence` - Float (`0.0` - `1.0`)
- `match_reason` - Text (`"Business return token"`, etc.)
- `match_source` - Text (`"filename"`, future: `"ocr"`, `"ai"`)

### JSON Columns (NOT NULL)
- `extracted_fields` - JSONB (default `{}`)
- `metadata` - JSONB (default `{}`)

---

## Key Differences Between Writers

| Writer | Auth | Source | Checklist Pre-Insert | Post-Insert Engine Call |
|--------|------|--------|---------------------|------------------------|
| #1 (deals/files/record) | Clerk user | `"internal"` | Optional client-provided | ✅ Always |
| #2 (portal/files/record) | Portal token | `"borrower"` | Optional client-provided | ✅ Always |
| #3 (portal/upload/commit) | Portal token | N/A (uses borrower_uploads) | N/A | ✅ Via FK lookup |
| #4 (public/upload) | Link password | `"borrower"` | Optional client-provided | ✅ Per file + reconcile once |

---

## What Happens After INSERT

### 1. Engine Stamping (`matchAndStampDealDocument`)
```typescript
// Runs filename matcher
const match = matchChecklistKeyFromFilename(originalFilename);

// If confident match (>= 0.6), UPDATE document
if (match.matchedKey && match.confidence >= 0.6) {
  await sb.from("deal_documents").update({
    checklist_key: match.matchedKey,
    doc_year: match.docYear ?? null,
    match_confidence: match.confidence,
    match_reason: match.reason,
    match_source: "filename",
  }).eq("id", documentId);
}
```

### 2. Checklist Reconciliation (`reconcileChecklistForDeal`)
```typescript
// 1. Seed checklist from ruleset (if not seeded)
// 2. Re-stamp any docs with missing checklist_key/doc_year
// 3. Year-aware satisfaction:
//    - Count docs per checklist_key+doc_year
//    - Compare to required_years
//    - Update satisfied_years, status, received_at
// 4. DB trigger computes final status
```

---

## Verification Queries

### Check Document Stamping
```sql
SELECT 
  original_filename,
  checklist_key,
  doc_year,
  match_confidence,
  match_reason,
  match_source,
  source,
  uploader_user_id,
  uploaded_via_link_id,
  created_at
FROM public.deal_documents
WHERE deal_id = '<your-deal-id>'
ORDER BY created_at DESC
LIMIT 10;
```

### Check Checklist Satisfaction
```sql
SELECT 
  checklist_key,
  title,
  required_years,
  satisfied_years,
  status,
  received_at,
  received_document_id
FROM public.deal_checklist_items
WHERE deal_id = '<your-deal-id>'
ORDER BY checklist_key;
```

### Check Year-Aware Matching
```sql
-- Should see multiple docs for same checklist_key with different years
SELECT 
  checklist_key,
  doc_year,
  COUNT(*) as doc_count,
  ARRAY_AGG(original_filename ORDER BY created_at DESC) as filenames
FROM public.deal_documents
WHERE deal_id = '<your-deal-id>' 
  AND checklist_key IS NOT NULL
GROUP BY checklist_key, doc_year
ORDER BY checklist_key, doc_year DESC;
```

---

## Test Scenarios

### Scenario 1: Single-Year Document
**Upload:** `Business Tax Return 2023.pdf`  
**Expected:**
- `checklist_key = "IRS_BUSINESS_2Y"`
- `doc_year = 2023`
- `match_confidence >= 0.7`
- Checklist shows `satisfied_years = [2023]` (if needs 2 years: still `missing`)

### Scenario 2: Multi-Year Completion
**Upload 1:** `Business Tax Return 2023.pdf`  
**Upload 2:** `Business Tax Return 2022.pdf`  
**Expected:**
- Both docs stamped with `IRS_BUSINESS_2Y`
- One has `doc_year = 2023`, other `doc_year = 2022`
- After 2nd upload, checklist shows:
  - `satisfied_years = [2022, 2023]`
  - `status = 'received'`
  - `received_at = NOW()`

### Scenario 3: No Year in Filename
**Upload:** `PFS.pdf`  
**Expected:**
- `checklist_key = "PFS_CURRENT"`
- `doc_year = NULL`
- `match_confidence >= 0.8`
- Checklist satisfied (PFS doesn't require years)

### Scenario 4: Unrecognized Filename
**Upload:** `random_scan.jpg`  
**Expected:**
- `checklist_key = NULL` (confidence too low)
- `doc_year = NULL`
- `match_confidence < 0.6`
- Checklist NOT satisfied (needs manual classification)

---

**Summary:** All 4 writers now produce consistent, engine-stamped documents with year-aware checklist reconciliation! 🎯
