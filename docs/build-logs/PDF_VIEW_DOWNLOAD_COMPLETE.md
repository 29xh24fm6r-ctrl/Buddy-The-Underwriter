# PDF View/Download System - Complete ✅

## What Was Added

### 1. **Signed URL Endpoint** 
`src/app/api/deals/[dealId]/memos/[docId]/signed-url/route.ts`

- Returns 10-minute signed URLs for viewing/downloading PDFs
- Validates deal ownership and PDF existence
- Used by both MemoGenerator and OutputsList

### 2. **Enhanced MemoGenerator Component**

**New Buttons:**
- **Preview HTML** - Opens `/deals/{dealId}/memos/{docId}/preview` in new tab
- **View PDF** - If PDF exists, opens signed URL directly
- **Generate PDF** - If no PDF, renders new one then opens it

**Smart Flow:**
1. User generates memo JSON
2. Clicks "Preview HTML" to verify content
3. Clicks "Generate PDF" → Playwright renders → signed URL opens automatically
4. Future clicks show "View PDF" (no re-rendering needed)

### 3. **Updated OutputsList Component**

**Each Document Row:**
- **Preview** button - Always available (HTML preview)
- **View PDF** button - Only if `pdf_storage_path` exists
- Uses new signed-url endpoint

### 4. **Tier-1 MemoTemplate Enhancements**

**Page 1 Now Includes:**
- `header.collateral_address`
- `header.request_summary`
- `proposed_terms.rate_summary` (fallback to all_in_rate)
- **Extended metrics box:**
  - Debt Yield
  - Cap Rate
  - DSCR (Stressed)
  - Stabilization Status

All fields are forgiving with multiple fallback paths.

### 5. **Print CSS** (globals.css)

```css
@media print {
  body { background: white !important; }
  .no-print { display: none !important; }
  table { page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  /* ... etc */
}
```

Ensures Playwright PDFs have proper page breaks and print-optimized styling.

---

## User Flow

### From Command Center:

1. **Generate Memo** → JSON stored in DB
2. **Preview HTML** → See exactly what will be in PDF
3. **Generate PDF** → Playwright captures preview, uploads to Storage
4. **View PDF** → Opens signed URL (re-usable for 10 min)

### From Outputs Tab:

- See all generated documents
- **Preview** any memo (HTML)
- **View PDF** if generated

---

## Testing

### Quick Check:
```bash
# In pricing-memo page:
# 1. Generate risk facts
# 2. Create pricing quote  
# 3. Generate memo
# 4. Click "Preview HTML" - should open in new tab
# 5. Click "Generate PDF" - Playwright renders, PDF opens
# 6. Refresh page - button changes to "View PDF"
```

### Verify Storage:
```sql
select id, deal_id, doc_type, status, pdf_storage_path, created_at
from generated_documents
where pdf_storage_path is not null
order by created_at desc
limit 10;
```

Should see paths like: `deals/{dealId}/credit_memo_{docId}.pdf`

### Signed URL Test:
```bash
curl http://localhost:3000/api/deals/{dealId}/memos/{docId}/signed-url
# Returns: { "url": "https://supabase.co/storage/v1/object/sign/..." }
```

---

## Next Phase (When Ready)

### Tables to Add:

1. **Sources & Uses** 
   - `memo.sources_uses.sources[]`
   - `memo.sources_uses.uses[]`

2. **Financial Table**
   - `memo.financial_analysis.historical_financials[]`
   - Year-over-year NOI, revenue, expenses

3. **Risk Register**
   - Already have `memo.risk_factors[]` - just format as table

4. **Conditions**
   - `memo.conditions.precedent[]`
   - `memo.conditions.ongoing[]`

All can be added to `MemoTemplate.tsx` without touching the pipeline.

---

## Current Status

✅ Signed URL endpoint  
✅ MemoGenerator with 3 buttons (Preview/Generate/View)  
✅ OutputsList with Preview + View PDF  
✅ Enhanced MemoTemplate (10+ new fields)  
✅ Print CSS for Playwright  
✅ Zero TypeScript errors  

**Ready to test end-to-end!**
