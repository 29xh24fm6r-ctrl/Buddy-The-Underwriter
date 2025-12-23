# Pricing + Memo Quick Reference

## 🚀 Quick Start

### 1. Run Migration
```bash
psql "$DATABASE_URL" < migrations/create_pricing_memo_tables.sql
```

### 2. Create Storage Bucket
Supabase Dashboard → Storage → Create bucket: `generated-documents` (private)

### 3. Install Dependencies
```bash
npm install pdfkit @types/pdfkit
```

### 4. Navigate to Page
```
/deals/[dealId]/pricing-memo
```

## 📋 Workflow Checklist

- [ ] **Snapshot** - Select latest snapshot version
- [ ] **Generate Facts** - Click "Generate Facts" button
- [ ] **Create Quote** - Click "Create Draft from Facts"
- [ ] **Edit Quote** (optional) - Modify rate/fees/terms
- [ ] **Mark Proposed** - Change status from draft
- [ ] **Generate Memo** - Click "Generate Memo JSON"
- [ ] **Render PDF** - Click "Generate PDF"
- [ ] **Download** - Open PDF from Outputs tab

## 🎯 API Endpoints

### Generate Risk Facts
```bash
POST /api/deals/{dealId}/risk-facts/generate
Body: { "snapshotId": "abc-123" }
```

### Create Pricing Quote
```bash
POST /api/deals/{dealId}/pricing-quotes/create
Body: { "snapshotId": "abc-123", "riskFactsId": "def-456" }
```

### Update Quote
```bash
PATCH /api/deals/{dealId}/pricing-quotes/{quoteId}
Body: { "status": "proposed" }
```

### Generate Memo
```bash
POST /api/deals/{dealId}/memos/generate
Body: {
  "snapshotId": "abc-123",
  "riskFactsId": "def-456",
  "pricingQuoteId": "ghi-789"
}
```

### Render PDF
```bash
POST /api/deals/{dealId}/memos/{docId}/render-pdf
```

## 🧮 Pricing Formula

```
Risk Rating = Base (5) +/- Adjustments
  • DSCR ≥ 1.5: -1
  • LTV ≤ 65%: -1
  • Experience ≥ 10yr: -1
  • Full Recourse: -1
  • DSCR < 1.25: +1
  • LTV > 75%: +1
  • Occupancy < 80%: +1

Base Margin = 300bps + (Risk Rating - 5) × 50bps

Adjustments:
  • Low DSCR: +50bps
  • High LTV: +25bps
  • Non-recourse: +75bps
  • Exceptions: +25bps each

Final Rate = SOFR + (Base Margin + Adjustments)
```

## 📊 Data Structure

### Risk Facts
```json
{
  "borrower": { "entity_name": "", "guarantors": [], "sponsor_experience_years": 0 },
  "collateral": { "ltv": 0, "dscr": 0, "occupancy": 0 },
  "loan": { "requested_amount": 0, "term_months": 0 },
  "financial": { "noi": 0, "liquidity": 0 },
  "exceptions": []
}
```

### Pricing Quote
```json
{
  "product": "bridge",
  "rate": { "margin_bps": 350, "index": "SOFR", "all_in_rate": 0.0885 },
  "fees": { "origination": 10000, "underwriting": 5000 },
  "structure": { "ltv_limit": 75, "dscr_min": 1.25 }
}
```

## 🗄️ Database Tables

```sql
-- Check if tables exist
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('risk_facts', 'pricing_quotes', 'generated_documents');

-- View risk facts for deal
SELECT id, facts_hash, created_at 
FROM risk_facts 
WHERE deal_id = 'xxx' 
ORDER BY created_at DESC;

-- View pricing quotes
SELECT id, status, created_at
FROM pricing_quotes
WHERE deal_id = 'xxx'
ORDER BY created_at DESC;

-- View generated documents
SELECT id, doc_type, status, pdf_storage_path
FROM generated_documents
WHERE deal_id = 'xxx'
ORDER BY created_at DESC;
```

## 🐛 Troubleshooting

### No snapshots found
```sql
-- Check snapshots exist
SELECT COUNT(*) FROM deal_context_snapshots WHERE deal_id = 'xxx';
```

### Facts not generating
- Check snapshot has context: `SELECT context FROM deal_context_snapshots WHERE id = 'xxx';`
- Check browser console for API errors
- Verify snapshot belongs to correct deal

### Pricing fails
- Ensure risk_facts exists first
- Check for critical null values (LTV, DSCR)
- Verify risk_facts_id matches snapshot

### PDF rendering fails
```bash
# Check pdfkit installed
npm list pdfkit

# Check storage bucket exists
# Supabase Dashboard → Storage → generated-documents

# Check RLS policies allow uploads
```

### PDF won't download
- Signed URLs expire after 1 hour
- Check browser allows pop-ups
- Verify Storage bucket is private (not public)

## 🧪 Test Script

```bash
# Run full test suite
./test-pricing-memo.sh <deal-id>

# Example
./test-pricing-memo.sh abc-123-def-456
```

## 🎨 UI Components

### SnapshotPicker
- Dropdown of snapshot versions
- Shows selected version number

### RiskFactsCard
- Metric cards (LTV, DSCR, NOI, etc.)
- Confidence indicators
- Policy exceptions list
- Regenerate button

### PricingQuoteEditor
- Rate structure form
- Fees editor
- Status pills (draft/proposed/sent)
- Edit/Save controls
- Quote preview

### MemoGenerator
- Generate memo button
- Outline/JSON view toggle
- Section navigation
- PDF render button

### OutputsList
- All generated documents
- Status badges
- PDF download links
- Version history

## 📁 File Locations

### API Routes
```
src/app/api/deals/[dealId]/
├── risk-facts/generate/route.ts
├── pricing-quotes/create/route.ts
├── pricing-quotes/[quoteId]/route.ts
├── memos/generate/route.ts
└── memos/[docId]/render-pdf/route.ts
```

### Shared Logic
```
src/lib/
├── risk/normalizeRiskFacts.ts
├── pricing/generatePricingQuote.ts
├── memo/generateCreditMemoJson.ts
├── pdf/renderCreditMemoPdf.ts
└── storage/uploadGeneratedPdf.ts
```

### UI Components
```
src/components/deals/pricing-memo/
├── SnapshotPicker.tsx
├── RiskFactsCard.tsx
├── PricingQuoteEditor.tsx
├── MemoGenerator.tsx
└── OutputsList.tsx
```

## 🔗 Navigation

Add to HeroBar:
```tsx
{ label: "Pricing + Memo", href: `/deals/${dealId}/pricing-memo` }
```

## 📚 Full Documentation

See [PRICING_MEMO_SYSTEM.md](./PRICING_MEMO_SYSTEM.md) for complete details.

---

**Ready!** Navigate to `/deals/[dealId]/pricing-memo` to start.
