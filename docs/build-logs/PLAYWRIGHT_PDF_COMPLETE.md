# Playwright PDF Generation - Complete

## ✅ What Was Implemented

### 1. **MemoTemplate Component**
**File:** `src/components/memo/MemoTemplate.tsx`

- React component that renders memo JSON to beautiful HTML
- Uses Tailwind CSS for styling
- Forgiving `get()` helper that handles missing/undefined fields gracefully
- Displays all memo sections: header, summary, transaction, collateral, financials, risks, etc.
- Print-friendly with proper formatting

### 2. **Preview Route**
**File:** `src/app/deals/[dealId]/memos/[docId]/preview/page.tsx`

- Server component that fetches memo from database
- Renders full HTML page with MemoTemplate
- Accessible at: `/deals/{dealId}/memos/{docId}/preview`
- Can be viewed in browser before PDF generation
- Provides visual verification

### 3. **Playwright PDF Renderer**
**File:** `src/app/api/deals/[dealId]/memos/[docId]/render-pdf/route.ts`

- **Replaced pdfkit** with Playwright + Chromium
- Launches headless browser
- Navigates to preview URL
- Captures as PDF with Letter format + margins
- Uploads to Supabase Storage (`generated-documents` bucket)
- Updates database with `pdf_storage_path`
- Returns `{ ok: true, pdf_storage_path, previewUrl }`

## 🔧 Dependencies

```json
{
  "devDependencies": {
    "playwright": "^1.49.1"
  }
}
```

**Installed:**
- ✅ `npm i -D playwright`
- ✅ `npx playwright install --with-deps chromium`
- ✅ Chromium browser + all system dependencies (fonts, X11, Mesa drivers)

## 🧪 Testing

### Test Script
**File:** `test-pdf-generation.sh`

Complete end-to-end test:
1. Generate risk facts
2. Create pricing quote
3. Generate credit memo JSON
4. Render PDF with Playwright
5. Verify storage path + preview URL

**Usage:**
```bash
./test-pdf-generation.sh
```

### Manual Testing

```bash
# 1. Start dev server
npm run dev

# 2. Generate memo (use actual API calls or existing data)
# Get a doc_id from generated_documents table

# 3. Preview in browser
open http://localhost:3000/deals/test-deal-123/memos/{docId}/preview

# 4. Generate PDF
curl -X POST http://localhost:3000/api/deals/test-deal-123/memos/{docId}/render-pdf

# Response:
# {
#   "ok": true,
#   "generated_document": { ... },
#   "pdf_storage_path": "test-deal-123/credit_memo_{docId}.pdf",
#   "previewUrl": "http://localhost:3000/deals/test-deal-123/memos/{docId}/preview"
# }
```

## 📋 Remaining Setup Steps

### 1. Run Migration
```bash
psql $DATABASE_URL -f supabase/migrations/20251223_pricing_memo_tables.sql
```

### 2. Create Storage Bucket

In Supabase Dashboard:
1. Go to Storage
2. Create new bucket: `generated-documents`
3. Set to **Private**
4. Add RLS policies:

```sql
-- Allow service role to upload
CREATE POLICY "Service role can upload"
ON storage.objects FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'generated-documents');

-- Allow authenticated users to read their own deals
CREATE POLICY "Users can view their deal documents"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'generated-documents' 
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM deals WHERE user_id = auth.uid()
  )
);
```

## 🎯 Why Playwright > pdfkit?

### Playwright Advantages:
1. **True browser rendering** - Same output you see in preview
2. **Full CSS support** - Tailwind, flexbox, grid, etc.
3. **Easy debugging** - Preview in browser first, then PDF
4. **Better fonts** - Uses system fonts, no font file management
5. **Mature layout engine** - Chromium's battle-tested rendering
6. **Print-specific CSS** - `@media print` support

### pdfkit Limitations:
1. Manual layout calculations
2. Limited font support
3. No CSS styling
4. Hard to debug
5. Verbose API for complex layouts

## 🚀 Workflow

```
User Request
    ↓
Generate Risk Facts (AI analysis)
    ↓
Create Pricing Quote (risk-based algorithm)
    ↓
Generate Credit Memo JSON (structured content)
    ↓
Preview Route (MemoTemplate renders HTML)
    ↓
Playwright PDF (headless Chromium → PDF)
    ↓
Supabase Storage (uploaded)
    ↓
Database Updated (pdf_storage_path)
```

## 📂 File Structure

```
src/
├── components/
│   └── memo/
│       └── MemoTemplate.tsx          # HTML rendering component
├── app/
│   ├── deals/[dealId]/
│   │   ├── pricing-memo/
│   │   │   └── page.tsx              # Main UI
│   │   └── memos/[docId]/
│   │       └── preview/
│   │           └── page.tsx          # Preview route
│   └── api/
│       └── deals/[dealId]/
│           ├── risk-facts/
│           │   └── generate/route.ts
│           ├── pricing-quotes/
│           │   └── create/route.ts
│           └── memos/
│               ├── generate/route.ts
│               └── [docId]/
│                   └── render-pdf/
│                       └── route.ts  # Playwright PDF generator
├── lib/
│   ├── risk/normalizeRiskFacts.ts
│   ├── pricing/generatePricingQuote.ts
│   └── memo/generateCreditMemoJson.ts
└── ...
```

## ✅ Status

- [x] Database schema
- [x] Risk normalization
- [x] Pricing algorithm
- [x] Memo generation
- [x] UI components
- [x] **MemoTemplate component**
- [x] **Preview route**
- [x] **Playwright PDF renderer**
- [x] **Chromium installed**
- [x] **Test scripts**
- [ ] Run migration
- [ ] Create storage bucket
- [ ] Test end-to-end

## 🎉 Ready to Test!

The dev server is running. Once you:
1. Run the migration
2. Create the storage bucket

You can test the complete pipeline with:
```bash
./test-pdf-generation.sh
```

**Preview any memo at:**
`http://localhost:3000/deals/{dealId}/memos/{docId}/preview`
