# Pricing Quote Writer + Memo Generator

**Complete implementation of risk-based pricing and credit memo generation system.**

## 🎯 Overview

This system provides end-to-end pricing quote generation and credit memo authoring from deal snapshots:

1. **Risk Facts Normalization** - Extract structured risk data from snapshot context
2. **Pricing Quote Generation** - Calculate risk-based pricing with transparent assumptions
3. **Credit Memo Generation** - Create comprehensive memo JSON from facts + pricing
4. **PDF Rendering** - Export memos to PDF stored in Supabase Storage

## 📊 Data Flow

```
deal_context_snapshots.context
    ↓
risk_facts (normalized, versioned)
    ↓
pricing_quotes (editable, status-tracked)
    ↓
generated_documents (JSON + PDF)
```

## 🗄️ Database Schema

### Tables Created

**risk_facts**
- Normalized risk metrics from snapshot
- Fields: borrower, collateral, loan, financial, exceptions
- Deterministic `facts_hash` for caching

**pricing_quotes**
- Pricing proposals with assumptions
- Status: draft → proposed → sent → archived
- Fully editable quote structure

**generated_documents**
- Versioned memo outputs
- doc_type: credit_memo | pricing_quote | term_sheet
- Links to source facts + pricing via `source` JSON

### Storage Bucket

**generated-documents** (private)
- Path pattern: `deals/{dealId}/{docType}/{docId}.pdf`
- Signed URLs for secure access

## 🚀 Setup

### 1. Run Migration

```bash
psql "$DATABASE_URL" < migrations/create_pricing_memo_tables.sql
```

### 2. Create Storage Bucket

In Supabase Dashboard → Storage:
- Create bucket: `generated-documents`
- Set as private
- Configure RLS policies for authenticated users

### 3. Install Dependencies

```bash
npm install pdfkit @types/pdfkit
```

## 📁 File Structure

```
src/
├── lib/
│   ├── risk/
│   │   └── normalizeRiskFacts.ts     # Extract facts from snapshot
│   ├── pricing/
│   │   └── generatePricingQuote.ts   # Generate pricing from facts
│   ├── memo/
│   │   └── generateCreditMemoJson.ts # Create memo JSON
│   ├── pdf/
│   │   └── renderCreditMemoPdf.ts    # Render PDF from JSON
│   └── storage/
│       └── uploadGeneratedPdf.ts     # Upload to Supabase Storage
├── app/
│   ├── api/deals/[dealId]/
│   │   ├── risk-facts/generate/route.ts
│   │   ├── pricing-quotes/create/route.ts
│   │   ├── pricing-quotes/[quoteId]/route.ts
│   │   ├── memos/generate/route.ts
│   │   └── memos/[docId]/render-pdf/route.ts
│   └── deals/[dealId]/pricing-memo/page.tsx
└── components/deals/pricing-memo/
    ├── SnapshotPicker.tsx
    ├── RiskFactsCard.tsx
    ├── PricingQuoteEditor.tsx
    ├── MemoGenerator.tsx
    └── OutputsList.tsx
```

## 🎨 UI Components

### Page Route

`/deals/[dealId]/pricing-memo`

### Tab Navigation

1. **Snapshot** - Select snapshot version + view raw context
2. **Risk Facts** - View normalized metrics + regenerate button
3. **Pricing Quote** - Edit rate/fees/structure + mark proposed
4. **Memo Generator** - Generate memo JSON + render PDF
5. **Outputs** - List all generated documents with PDF links

## 🔄 Workflow

### Generate Risk Facts

```typescript
POST /api/deals/[dealId]/risk-facts/generate
Body: { snapshotId }
Returns: { risk_facts, cached: boolean }
```

Extracts:
- Borrower info (entity, guarantors, experience)
- Collateral metrics (LTV, DSCR, occupancy, valuation)
- Loan request (amount, term, recourse)
- Financial data (NOI, liquidity, net worth)
- Policy exceptions

### Create Pricing Quote

```typescript
POST /api/deals/[dealId]/pricing-quotes/create
Body: { snapshotId, riskFactsId }
Returns: { pricing_quote }
```

Generates:
- Risk rating (1-10 scale)
- Base margin + adjustments (bps)
- Rate structure (index + margin = all-in)
- Fees (origination, underwriting, legal, exit)
- Covenants + conditions
- Rationale + sensitivities

### Update Pricing Quote

```typescript
PATCH /api/deals/[dealId]/pricing-quotes/[quoteId]
Body: { quote?, assumptions?, status? }
Returns: { pricing_quote }
```

Edit any field in quote object or change status.

### Generate Credit Memo

```typescript
POST /api/deals/[dealId]/memos/generate
Body: { snapshotId, riskFactsId, pricingQuoteId? }
Returns: { generated_document }
```

Creates memo JSON with sections:
- Header (deal name, borrower, date, request)
- Executive summary (narrative, risks, mitigants)
- Transaction overview (loan request, sources/uses)
- Borrower/sponsor analysis
- Collateral analysis
- Financial analysis (NOI, DSCR, stress tests)
- Risk factors
- Policy exceptions
- Proposed terms (from pricing quote)
- Conditions (precedent, ongoing)
- Appendix (tables, raw metrics)
- References (snapshot_id, risk_facts_id, facts_hash)

### Render PDF

```typescript
POST /api/deals/[dealId]/memos/[docId]/render-pdf
Returns: { generated_document, pdf_url }
```

- Renders content_json to PDF via pdfkit
- Uploads to `generated-documents` bucket
- Updates document with `pdf_storage_path`
- Sets status to "final"
- Returns signed URL (1-hour expiry)

## 📊 Risk Facts Structure

```typescript
{
  borrower: {
    entity_name: string;
    guarantors: string[];
    sponsor_experience_years: number | null;
  };
  collateral: {
    property_type: string | null;
    address: string | null;
    occupancy: number | null;  // %
    dscr: number | null;       // x.xx
    ltv: number | null;        // %
    as_is_value: number | null;
    stabilized_value: number | null;
  };
  loan: {
    requested_amount: number | null;
    purpose: string | null;
    term_months: number | null;
    amort_months: number | null;
    recourse_type: string | null;
  };
  financial: {
    noi: number | null;
    ebitda: number | null;
    cash_on_cash: number | null;
    liquidity: number | null;
    net_worth: number | null;
  };
  exceptions: Array<{
    policy: string;
    description: string;
    severity: "low" | "medium" | "high";
  }>;
}
```

## 💰 Pricing Quote Structure

```typescript
{
  product: "bridge" | "perm" | "construction";
  rate: {
    margin_bps: number;
    index: string;           // "SOFR"
    floor: number;
    all_in_rate: number;     // decimal (0.0875 = 8.75%)
  };
  fees: {
    origination: number;
    underwriting: number;
    legal: number;
    exit: number;
  };
  structure: {
    ltv_limit: number;       // %
    dscr_min: number;        // x.xx
    reserves: number;        // $
    covenants: string[];
  };
  conditions: {
    precedent: string[];
    ongoing: string[];
  };
  rationale: string;
  sensitivities: {
    base: { rate: number; payment: number; };
    upside: { rate: number; payment: number; };
    downside: { rate: number; payment: number; };
  };
}
```

## 🧮 Pricing Logic

### Risk Rating Calculation

Starting at 5 (medium risk):

**Positive factors (reduce risk):**
- DSCR ≥ 1.5: -1
- LTV ≤ 65%: -1
- Sponsor experience ≥ 10 years: -1
- Full recourse: -1

**Negative factors (increase risk):**
- DSCR < 1.25: +1
- LTV > 75%: +1
- Occupancy < 80%: +1
- High-severity policy exceptions: +1

Final rating clamped to 1-10.

### Margin Calculation

```
Base Margin = 300bps + (risk_rating - 5) * 50bps

Adjustments:
- Low DSCR (<1.25): +50bps
- High LTV (>75%): +25bps
- Non-recourse: +75bps
- Policy exceptions: +25bps per high-severity

Final Margin = Base + Adjustments
All-in Rate = Index + (Final Margin / 10000)
```

## 📄 PDF Rendering

Using `pdfkit` with structured sections:

1. **Header** - Memo title, deal name, borrower, date
2. **Executive Summary** - Narrative + key risks + mitigants
3. **Transaction Overview** - Amount, purpose, term
4. **Borrower & Sponsor** - Background, experience, guarantors
5. **Collateral Analysis** - Property description, valuation
6. **Financial Analysis** - NOI, DSCR metrics
7. **Risk Factors** - Risks with severity + mitigants
8. **Policy Exceptions** - Exceptions with rationale
9. **Proposed Terms** - Full pricing quote (if included)
10. **Footer** - Generated timestamp, deal ID, doc ID

## 🎯 Usage Example

### Complete Flow

```typescript
// 1. User selects snapshot
const snapshotId = "abc-123";

// 2. Generate risk facts
const factsRes = await fetch(`/api/deals/${dealId}/risk-facts/generate`, {
  method: "POST",
  body: JSON.stringify({ snapshotId }),
});
const { risk_facts } = await factsRes.json();

// 3. Create pricing quote
const quoteRes = await fetch(`/api/deals/${dealId}/pricing-quotes/create`, {
  method: "POST",
  body: JSON.stringify({
    snapshotId,
    riskFactsId: risk_facts.id,
  }),
});
const { pricing_quote } = await quoteRes.json();

// 4. Edit quote (optional)
const updateRes = await fetch(`/api/deals/${dealId}/pricing-quotes/${pricing_quote.id}`, {
  method: "PATCH",
  body: JSON.stringify({
    quote: { ...pricing_quote.quote, rate: { ...pricing_quote.quote.rate, margin_bps: 400 } },
  }),
});

// 5. Mark as proposed
await fetch(`/api/deals/${dealId}/pricing-quotes/${pricing_quote.id}`, {
  method: "PATCH",
  body: JSON.stringify({ status: "proposed" }),
});

// 6. Generate credit memo
const memoRes = await fetch(`/api/deals/${dealId}/memos/generate`, {
  method: "POST",
  body: JSON.stringify({
    snapshotId,
    riskFactsId: risk_facts.id,
    pricingQuoteId: pricing_quote.id,
  }),
});
const { generated_document } = await memoRes.json();

// 7. Render PDF
const pdfRes = await fetch(`/api/deals/${dealId}/memos/${generated_document.id}/render-pdf`, {
  method: "POST",
});
const { pdf_url } = await pdfRes.json();

// 8. Open PDF
window.open(pdf_url, "_blank");
```

## 🔧 Enhancement Opportunities

### Risk Facts
- Add ML-based confidence scoring
- Support multiple snapshot comparison
- Auto-detect missing fields + suggest sources

### Pricing
- Integrate real-time SOFR rates API
- Add historical pricing comparisons
- Support custom pricing models per lender

### Memos
- AI-enhanced narrative generation (GPT-4)
- Custom memo templates per loan type
- Collaborative editing with comments
- Version diff visualization

### PDF
- Custom branding/logo per institution
- Interactive PDF forms
- DocuSign integration
- Multi-language support

## 🐛 Troubleshooting

### Facts not generating
- Check snapshot exists: `SELECT * FROM deal_context_snapshots WHERE id = ?`
- Verify context field has data
- Check browser console for API errors

### Pricing quote errors
- Ensure risk_facts exists first
- Check for null values in critical fields (LTV, DSCR)
- Verify SOFR rate is accessible (currently hardcoded 5.35%)

### PDF rendering fails
- Ensure pdfkit is installed: `npm install pdfkit @types/pdfkit`
- Check Storage bucket exists and is private
- Verify RLS policies allow authenticated uploads
- Check browser console for CORS errors

### PDF won't download
- Signed URLs expire after 1 hour - regenerate if needed
- Check bucket permissions
- Verify pdf_storage_path is set in database

## 📚 Related Documentation

- [DEAL_COMMAND_CENTER.md](./DEAL_COMMAND_CENTER.md) - Main command center
- [UPLOAD_INTELLIGENCE_SETUP.md](./UPLOAD_INTELLIGENCE_SETUP.md) - Document extraction
- [NAVIGATION_SYSTEM.md](./NAVIGATION_SYSTEM.md) - Global navigation

---

**Ready to test!** Navigate to `/deals/[dealId]/pricing-memo` to start generating pricing quotes and credit memos.
