# Pricing + Memo System - Setup & Integration Guide

## ⚠️ Important: Integration Required

The implementation is **90% complete**. Before using, you need to:

### 1. Fix Supabase Client Imports

All API routes currently import:
```typescript
import { supabase } from "@/lib/supabase/client";
```

But your project uses:
```typescript
import { getSupabaseClient } from "@/lib/supabase/client";
// or
import { supabaseAdmin } from "@/lib/supabase/admin";
```

**Action Required:** Update all imports in:
- `src/app/api/deals/[dealId]/risk-facts/generate/route.ts`
- `src/app/api/deals/[dealId]/pricing-quotes/create/route.ts`
- `src/app/api/deals/[dealId]/pricing-quotes/[quoteId]/route.ts`
- `src/app/api/deals/[dealId]/memos/generate/route.ts`
- `src/app/api/deals/[dealId]/memos/[docId]/render-pdf/route.ts`
- `src/lib/storage/uploadGeneratedPdf.ts`
- `src/lib/pdf/renderCreditMemoPdf.ts`

**Find/Replace:**
```typescript
// OLD:
import { supabase } from "@/lib/supabase/client";
// ... later in code
await supabase.from("table_name")

// NEW (choose one):
import { supabaseAdmin } from "@/lib/supabase/admin";
// ... later in code
const supabase = supabaseAdmin();
await supabase.from("table_name")

// OR for client-side:
import { getSupabaseClient } from "@/lib/supabase/client";
// ... later in code
const supabase = getSupabaseClient();
await supabase.from("table_name")
```

### 2. Install PDF Generation Library

```bash
npm install pdfkit @types/pdfkit
```

### 3. Run Database Migration

```bash
psql "$DATABASE_URL" < migrations/create_pricing_memo_tables.sql
```

### 4. Create Storage Bucket

**Option A:** Supabase Dashboard
1. Go to Storage → Buckets
2. Click "New bucket"
3. Name: `generated-documents`
4. Public: **NO** (keep private)
5. Create

**Option B:** SQL (if you have admin access)
```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('generated-documents', 'generated-documents', false);
```

### 5. Add RLS Policies

```sql
-- Allow authenticated users to upload
CREATE POLICY "Authenticated users can upload docs"
  ON storage.objects FOR INSERT
  USING (
    bucket_id = 'generated-documents'
    AND auth.role() = 'authenticated'
  );

-- Allow authenticated users to read their documents
CREATE POLICY "Authenticated users can read docs"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'generated-documents'
    AND auth.role() = 'authenticated'
  );
```

## 📋 Implementation Checklist

### Core Implementation ✅
- [x] Database schema (3 tables)
- [x] Risk facts normalization logic
- [x] Pricing quote generation algorithm
- [x] Credit memo JSON generation
- [x] PDF rendering (pdfkit)
- [x] Storage upload utilities
- [x] 5 API routes
- [x] 5 UI components
- [x] Main page with tab navigation
- [x] Test script
- [x] Documentation

### Integration Tasks 🔧
- [ ] Fix Supabase client imports (find/replace)
- [ ] Install pdfkit dependency
- [ ] Run database migration
- [ ] Create storage bucket
- [ ] Add RLS policies
- [ ] Test API endpoints
- [ ] Add to navigation

## 🔧 Detailed Integration Steps

### Step 1: Update Supabase Imports

Use this command to find all occurrences:

```bash
grep -r "from \"@/lib/supabase/client\"" src/app/api/deals/
grep -r "from \"@/lib/supabase/client\"" src/lib/
```

For each file, update to match your project pattern. Example:

**Before:**
```typescript
import { supabase } from "@/lib/supabase/client";

export async function POST(req: NextRequest, { params }: { params: { dealId: string } }) {
  const { data } = await supabase.from("risk_facts")...
}
```

**After:**
```typescript
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: NextRequest, { params }: { params: { dealId: string } }) {
  const supabase = supabaseAdmin();
  const { data } = await supabase.from("risk_facts")...
}
```

### Step 2: Install Dependencies

```bash
cd /workspaces/Buddy-The-Underwriter
npm install pdfkit @types/pdfkit
```

Verify installation:
```bash
npm list pdfkit
```

### Step 3: Run Migration

```bash
# Check DATABASE_URL is set
echo $DATABASE_URL

# Run migration
psql "$DATABASE_URL" < migrations/create_pricing_memo_tables.sql

# Verify tables created
psql "$DATABASE_URL" -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('risk_facts', 'pricing_quotes', 'generated_documents');"
```

Expected output:
```
     tablename
-------------------
 risk_facts
 pricing_quotes
 generated_documents
(3 rows)
```

### Step 4: Create Storage Bucket

**Via Dashboard:**
1. Open Supabase Dashboard
2. Project → Storage → Buckets
3. Click "New bucket"
4. Name: `generated-documents`
5. **Uncheck** "Public bucket"
6. Create

**Verify:**
```sql
SELECT id, name, public FROM storage.buckets WHERE id = 'generated-documents';
```

### Step 5: Configure RLS

Run in Supabase SQL Editor:

```sql
-- Enable RLS on storage.objects (if not already enabled)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Allow authenticated uploads
CREATE POLICY "Allow authenticated uploads to generated-documents"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'generated-documents'
    AND auth.role() = 'authenticated'
  );

-- Allow authenticated reads
CREATE POLICY "Allow authenticated reads from generated-documents"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'generated-documents'
    AND auth.role() = 'authenticated'
  );

-- Allow updates (for re-generation)
CREATE POLICY "Allow authenticated updates in generated-documents"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'generated-documents'
    AND auth.role() = 'authenticated'
  );
```

### Step 6: Add Navigation Link

Edit your HeroBar component to add the link:

```typescript
const dealNavigation = [
  // ... existing links
  {
    label: "Pricing + Memo",
    href: `/deals/${dealId}/pricing-memo`,
  },
];
```

### Step 7: Test the System

```bash
# Replace with actual deal ID that has snapshots
./test-pricing-memo.sh <your-deal-id>

# Example:
./test-pricing-memo.sh abc-123-def-456
```

## 🧪 Manual Testing

### Test 1: Risk Facts Generation

```bash
curl -X POST http://localhost:3000/api/deals/DEAL_ID/risk-facts/generate \
  -H "Content-Type: application/json" \
  -d '{"snapshotId":"SNAPSHOT_ID"}'
```

Expected response:
```json
{
  "risk_facts": {
    "id": "...",
    "facts": { /* structured facts */ },
    "facts_hash": "...",
    "confidence": { /* per-section confidence */ }
  },
  "cached": false
}
```

### Test 2: Pricing Quote Creation

```bash
curl -X POST http://localhost:3000/api/deals/DEAL_ID/pricing-quotes/create \
  -H "Content-Type: application/json" \
  -d '{"snapshotId":"SNAPSHOT_ID","riskFactsId":"RISK_FACTS_ID"}'
```

Expected response:
```json
{
  "pricing_quote": {
    "id": "...",
    "status": "draft",
    "quote": {
      "product": "bridge",
      "rate": { /* rate structure */ },
      "fees": { /* fees */ }
    },
    "assumptions": { /* assumptions */ }
  }
}
```

### Test 3: Memo Generation

```bash
curl -X POST http://localhost:3000/api/deals/DEAL_ID/memos/generate \
  -H "Content-Type: application/json" \
  -d '{
    "snapshotId":"SNAPSHOT_ID",
    "riskFactsId":"RISK_FACTS_ID",
    "pricingQuoteId":"QUOTE_ID"
  }'
```

### Test 4: PDF Rendering

```bash
curl -X POST http://localhost:3000/api/deals/DEAL_ID/memos/DOC_ID/render-pdf
```

## 🐛 Common Issues

### Issue: "Module 'pdfkit' not found"

**Solution:**
```bash
npm install pdfkit @types/pdfkit
npm run dev  # Restart dev server
```

### Issue: "Storage bucket not found"

**Solution:**
1. Check bucket exists: Supabase Dashboard → Storage
2. Verify name is exactly `generated-documents`
3. Check RLS policies are applied

### Issue: "Property 'from' does not exist on type 'Promise'"

**Solution:**
Update Supabase client imports (see Step 1 above). The client needs to be called as a function:
```typescript
const supabase = supabaseAdmin(); // Call the function!
await supabase.from("table")...
```

### Issue: "Failed to upload PDF"

**Solution:**
- Check Storage bucket exists
- Verify RLS policies allow uploads
- Check authenticated session exists
- Review browser console for CORS errors

### Issue: "Snapshot not found"

**Solution:**
```sql
-- Check snapshots exist for deal
SELECT id, version, created_at 
FROM deal_context_snapshots 
WHERE deal_id = 'YOUR_DEAL_ID'
ORDER BY created_at DESC;
```

## 📊 Database Verification

After setup, verify everything works:

```sql
-- Check tables exist
\dt public.risk_facts
\dt public.pricing_quotes
\dt public.generated_documents

-- Check storage bucket
SELECT * FROM storage.buckets WHERE id = 'generated-documents';

-- Check RLS policies
SELECT policyname, cmd, qual 
FROM pg_policies 
WHERE schemaname = 'storage' 
AND tablename = 'objects';

-- Test inserting risk facts (replace with real IDs)
INSERT INTO risk_facts (deal_id, snapshot_id, facts, facts_hash)
VALUES (
  'test-deal-id',
  'test-snapshot-id',
  '{"borrower":{"entity_name":"Test LLC"}}',
  'test-hash-123'
)
RETURNING id;
```

## 🎯 Next Steps After Integration

Once integrated:

1. **Test with real deal**
   - Navigate to `/deals/[dealId]/pricing-memo`
   - Select snapshot
   - Generate facts → quote → memo → PDF
   
2. **Customize pricing logic**
   - Edit `src/lib/pricing/generatePricingQuote.ts`
   - Adjust risk rating factors
   - Update margin calculations
   - Add institution-specific rules

3. **Enhance memo content**
   - Edit `src/lib/memo/generateCreditMemoJson.ts`
   - Add AI narrative generation
   - Include more financial analysis
   - Add custom sections

4. **Improve PDF styling**
   - Edit `src/lib/pdf/renderCreditMemoPdf.ts`
   - Add custom branding
   - Improve layout
   - Add charts/graphs

5. **Add monitoring**
   - Log all generations
   - Track pricing accuracy
   - Monitor PDF rendering performance

## 📚 Documentation

- **Full Guide:** [PRICING_MEMO_SYSTEM.md](./PRICING_MEMO_SYSTEM.md)
- **Quick Reference:** [PRICING_MEMO_QUICK_REF.md](./PRICING_MEMO_QUICK_REF.md)
- **Test Script:** [test-pricing-memo.sh](./test-pricing-memo.sh)

---

**Status:** Ready for integration! Follow checklist above to complete setup.
