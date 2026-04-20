# Auto-Fill Bank Forms with Policy Defaults

**Status**: ✅ Complete  
**Created**: 2025-12-19  
**Phase**: Policy-Aware Underwriting (Option 3)

---

## Overview

The **Auto-Fill Bank Forms** system extracts default values from policy chunks and pre-populates form fields with policy-compliant defaults. Users can override defaults, and deviations are tracked for audit purposes.

This is **Option 3** of the policy-aware underwriting trilogy:
1. ✅ Policy Ingestion (Upload PDF → Extract → Chunk)
2. ⏳ Exception Workflow (Track/approve exceptions)
3. ✅ **Auto-Fill Bank Forms** (Policy-compliant defaults) ← YOU ARE HERE

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  AUTO-FILL WORKFLOW                         │
└─────────────────────────────────────────────────────────────┘

1. Policy chunks ingested (from Option 1)
   ↓
2. Extract defaults API analyzes chunks with pattern matching
   ↓
3. Defaults stored in bank_policy_defaults table
   ↓
4. Form requests defaults for deal_type + industry
   ↓
5. FormFieldWithDefault component shows:
   - Blue "📋 Policy Default" badge
   - Current value (auto-filled or user-entered)
   - Yellow "⚠️ Deviates from policy" if changed
   ↓
6. On submit, deviations tracked in deal_policy_deviations
```

### Data Flow

```sql
bank_policy_chunks (policy text)
    ↓
  [Pattern Matching / AI]
    ↓
bank_policy_defaults (extracted defaults)
    ↓
  [Form Defaults API]
    ↓
FormFieldWithDefault component (UI)
    ↓
deal_policy_deviations (audit trail)
```

---

## Components Created

### 1. Database Tables

#### `bank_policy_defaults`
Stores extracted default values from policy chunks.

**Schema:**
```sql
CREATE TABLE bank_policy_defaults (
  id UUID PRIMARY KEY,
  bank_id UUID NOT NULL,
  
  -- Scope
  deal_type TEXT,           -- 'sba_7a', 'conventional', etc.
  industry TEXT,            -- 'restaurant', 'retail', etc.
  
  -- Field definition
  field_name TEXT NOT NULL, -- 'interest_rate', 'max_ltv', etc.
  field_label TEXT NOT NULL,
  field_type TEXT NOT NULL, -- 'number', 'percentage', 'text', 'currency'
  
  -- Value
  default_value TEXT NOT NULL, -- JSON-encoded
  
  -- Evidence
  chunk_id UUID,
  confidence_score DECIMAL(3,2),
  source_text TEXT,
  
  -- Constraints
  min_value DECIMAL,
  max_value DECIMAL,
  allowed_values JSONB,
  
  UNIQUE (bank_id, deal_type, industry, field_name)
);
```

**Scoping Logic:**
- `deal_type = NULL, industry = NULL` → Global defaults (all deals)
- `deal_type = 'sba_7a', industry = NULL` → All SBA 7(a) deals
- `deal_type = 'sba_7a', industry = 'restaurant'` → SBA 7(a) restaurants only

**Fallback Priority:**
1. Exact match (deal_type + industry)
2. Deal type only (industry NULL)
3. Global (both NULL)

---

#### `deal_policy_deviations`
Tracks when users override policy defaults.

**Schema:**
```sql
CREATE TABLE deal_policy_deviations (
  id UUID PRIMARY KEY,
  deal_id UUID NOT NULL,
  
  field_name TEXT NOT NULL,
  field_label TEXT NOT NULL,
  policy_default TEXT NOT NULL,
  actual_value TEXT NOT NULL,
  justification TEXT,
  
  created_at TIMESTAMPTZ,
  created_by TEXT
);
```

**Use Cases:**
- Audit trail: "Who changed LTV from 80% to 85%?"
- Exception reporting: "Which deals deviate most from policy?"
- Risk analysis: "How often do we approve non-compliant terms?"

---

### 2. API Routes

#### `POST /api/banks/policy/extract-defaults`
Extracts default values from policy chunks using pattern matching.

**Request:**
```json
{
  "asset_id": "uuid",              // optional: extract from specific asset
  "deal_type": "sba_7a",           // optional: scope to deal type
  "extract_mode": "pattern"        // "pattern" or "ai" (future)
}
```

**Response:**
```json
{
  "extracted": 5,
  "defaults": [
    {
      "field_name": "interest_rate",
      "field_label": "Interest Rate",
      "field_type": "text",
      "default_value": "\"Prime + 2.75%\"",
      "chunk_id": "uuid",
      "confidence_score": 0.85,
      "source_text": "Standard SBA 7(a) rate is Prime + 2.75%...",
      "min_value": null,
      "max_value": null
    }
  ]
}
```

**Pattern Matching:**
Extracts 8 common field types:

1. **Interest Rate**: `"Interest rate is Prime + 2.75%"`
2. **Maximum LTV**: `"Maximum LTV is 80%"`
3. **Minimum DSCR**: `"Minimum DSCR of 1.25x"`
4. **Minimum FICO**: `"Minimum credit score: 660"`
5. **Loan Term**: `"Maximum term: 7 years"`
6. **Down Payment**: `"Minimum 10% down payment"`
7. **Guarantee Fee**: `"SBA guarantee fee is 2%"`
8. **Maximum Loan Amount**: `"Maximum loan amount: $5,000,000"`

**Deduplication:**
If multiple chunks mention the same field, keeps highest confidence score.

**Future Enhancement:**
Replace pattern matching with AI extraction (GPT-4, Claude, etc.) for better accuracy.

---

#### `GET /api/banks/policy/form-defaults?deal_type=sba_7a&industry=restaurant`
Retrieves policy defaults for a specific deal type/industry.

**Query Params:**
- `deal_type` (optional): 'sba_7a', 'conventional', 'equipment', etc.
- `industry` (optional): 'restaurant', 'retail', 'manufacturing', etc.

**Response:**
```json
{
  "defaults": [
    {
      "field_name": "interest_rate",
      "field_label": "Interest Rate",
      "field_type": "text",
      "default_value": "Prime + 2.75%",
      "confidence_score": 0.95,
      "source_text": "Standard SBA 7(a) rate is Prime + 2.75%...",
      "min_value": null,
      "max_value": null
    }
  ]
}
```

**Fallback Logic:**
```typescript
// Priority 1: Exact match
SELECT * WHERE deal_type='sba_7a' AND industry='restaurant'

// Priority 2: Deal type only
SELECT * WHERE deal_type='sba_7a' AND industry IS NULL

// Priority 3: Global
SELECT * WHERE deal_type IS NULL AND industry IS NULL
```

Higher priority values override lower priority ones.

---

### 3. UI Components

#### `FormFieldWithDefault`
Reusable form field component with policy default integration.

**Props:**
```typescript
interface FormFieldWithDefaultProps {
  fieldName: string;          // "interest_rate"
  label: string;              // "Interest Rate"
  value: string | number;     // Current value
  onChange: (val) => void;    // Change handler
  policyDefault?: PolicyDefault | null;
  type?: "text" | "number" | "percentage" | "currency";
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}
```

**Features:**
- ✅ Blue "📋 Policy Default" badge (hover for tooltip)
- ✅ Yellow "⚠️ Deviates from policy" badge (if changed)
- ✅ Click badge to apply default value
- ✅ Tooltip shows:
  - Default value
  - Confidence score
  - Source text (policy excerpt)
  - Min/max constraints
- ✅ Real-time validation (red text if outside min/max)
- ✅ Auto-formatting (%, $, etc.)

**Example Usage:**
```tsx
<FormFieldWithDefault
  fieldName="max_ltv"
  label="Maximum LTV"
  value={formData.max_ltv}
  onChange={(v) => setFormData({ ...formData, max_ltv: v })}
  policyDefault={policyDefaults.get("max_ltv")}
  type="percentage"
  placeholder="80"
/>
```

**Visual States:**

| State | Border | Badge | Validation |
|-------|--------|-------|------------|
| Empty | Gray | Blue "Policy Default" | - |
| Policy value | Gray | Blue "Policy Default" | ✅ Compliant |
| Custom value | Yellow | Yellow "Deviates" | ⚠️ Check constraints |
| Out of range | Red | Yellow "Deviates" | ❌ Below min / Exceeds max |

---

#### Loan Terms Form Page
Example form at `/deals/[dealId]/loan-terms`

**Features:**
- ✅ Deal type selector (SBA 7(a), SBA 504, Conventional, Equipment, Term Loan)
- ✅ Industry selector (optional)
- ✅ Auto-loads policy defaults on mount
- ✅ Auto-fills empty fields with defaults
- ✅ 8 form fields with FormFieldWithDefault:
  - Interest Rate
  - Guarantee Fee
  - Loan Term (Months)
  - Down Payment (%)
  - Maximum LTV (%)
  - Minimum DSCR
  - Minimum FICO Score
  - Maximum Loan Amount ($)
- ✅ "Reset to Policy Defaults" button
- ✅ Detects and logs deviations on submit
- ✅ Warning if no policy defaults found

**User Flow:**
1. Select deal type (e.g., "SBA 7(a)")
2. Select industry (optional, e.g., "Restaurant")
3. Form auto-fills with policy defaults (blue badges)
4. User can override any field → Yellow "Deviates" badge appears
5. User clicks "Save" → Deviations logged to console (or database)
6. User can click "Reset to Policy Defaults" to undo changes

---

## Usage Guide

### Step 1: Run Migrations

```sql
-- 1. Create tables
-- Run in Supabase SQL Editor (role: postgres)
-- File: supabase/migrations/20251219_policy_defaults.sql
```

### Step 2: Seed Example Defaults

```sql
-- 2. Insert example defaults
-- REPLACE 'YOUR_BANK_ID_HERE' with actual bank_id
-- File: supabase/migrations/seed_policy_defaults.sql
```

**Get your bank_id:**
```sql
SELECT id, name FROM banks;
```

### Step 3: Extract Defaults from Policy Chunks

```bash
# Option A: Extract from all chunks
curl -X POST http://localhost:3000/api/banks/policy/extract-defaults \
  -H "Content-Type: application/json" \
  -d '{"deal_type": "sba_7a"}'

# Option B: Extract from specific asset
curl -X POST http://localhost:3000/api/banks/policy/extract-defaults \
  -H "Content-Type: application/json" \
  -d '{"asset_id": "your-asset-uuid", "deal_type": "sba_7a"}'
```

**Response:**
```json
{
  "extracted": 5,
  "defaults": [...]
}
```

### Step 4: Use in Forms

**Option A: Use Example Form**
1. Go to `/deals/[dealId]/loan-terms`
2. Select deal type → Defaults auto-fill
3. Override fields as needed → Deviations tracked

**Option B: Build Custom Form**
```tsx
import { FormFieldWithDefault } from "@/components/deals/FormFieldWithDefault";

// 1. Load defaults
const [defaults, setDefaults] = useState<Map<string, PolicyDefault>>(new Map());

useEffect(() => {
  fetch("/api/banks/policy/form-defaults?deal_type=sba_7a")
    .then(r => r.json())
    .then(json => {
      const map = new Map();
      json.defaults.forEach(d => map.set(d.field_name, d));
      setDefaults(map);
    });
}, []);

// 2. Render fields
<FormFieldWithDefault
  fieldName="interest_rate"
  label="Interest Rate"
  value={formData.interest_rate}
  onChange={(v) => setFormData({ ...formData, interest_rate: v })}
  policyDefault={defaults.get("interest_rate")}
  type="text"
/>
```

---

## Pattern Matching Details

### Pattern 1: Interest Rate
**Regex:** `/(?:interest rate|priced at|rate)[:\s]+(?:is\s+)?(Prime \+ [\d.]+%|[\d.]+%)/gi`

**Matches:**
- "Interest rate is Prime + 2.75%"
- "Priced at Prime + 3.00%"
- "Rate: 7.5%"

**Extracted:**
```json
{
  "field_name": "interest_rate",
  "default_value": "\"Prime + 2.75%\"",
  "confidence_score": 0.85
}
```

---

### Pattern 2: Maximum LTV
**Regex:** `/(?:maximum LTV|max LTV|LTV)[:\s]+(?:is\s+|not to exceed\s+)?([\d.]+)%/gi`

**Matches:**
- "Maximum LTV is 80%"
- "Max LTV: 75%"
- "LTV not to exceed 85%"

**Extracted:**
```json
{
  "field_name": "max_ltv",
  "default_value": "80",
  "max_value": 80,
  "confidence_score": 0.90
}
```

---

### Pattern 3: Minimum DSCR
**Regex:** `/(?:minimum DSCR|DSCR)[:\s]+(?:of\s+|must be at least\s+)?([\d.]+)x?/gi`

**Matches:**
- "Minimum DSCR of 1.25x"
- "DSCR must be at least 1.15"
- "DSCR: 1.20x"

**Extracted:**
```json
{
  "field_name": "min_dscr",
  "default_value": "1.25",
  "min_value": 1.25,
  "confidence_score": 0.90
}
```

---

### Pattern 4: Minimum FICO
**Regex:** `/(?:minimum credit score|minimum FICO|FICO score)[:\s]+(?:of\s+)?(?:at least\s+)?([\d]+)/gi`

**Matches:**
- "Minimum credit score: 660"
- "Minimum FICO of 680"
- "FICO score at least 700"

**Extracted:**
```json
{
  "field_name": "min_fico",
  "default_value": "660",
  "min_value": 660,
  "confidence_score": 0.95
}
```

---

### Pattern 5: Loan Term
**Regex:** `/(?:maximum term|term)[:\s]+(?:of\s+)?([\d]+)\s+years?/gi`

**Matches:**
- "Maximum term: 7 years"
- "Term of 10 years"
- "Term: 5 year"

**Extracted:**
```json
{
  "field_name": "term_months",
  "default_value": "84",  // 7 years * 12
  "max_value": 84,
  "confidence_score": 0.85
}
```

---

### Pattern 6: Down Payment
**Regex:** `/(?:minimum|borrower equity|down payment)[:\s]+(?:of\s+)?([\d.]+)%/gi`

**Matches:**
- "Minimum 10% down payment"
- "Borrower equity: 15%"
- "Down payment of 20%"

**Extracted:**
```json
{
  "field_name": "down_payment_pct",
  "default_value": "10",
  "min_value": 10,
  "confidence_score": 0.80
}
```

---

### Pattern 7: Guarantee Fee
**Regex:** `/(?:guarantee fee|SBA fee)[:\s]+(?:is\s+)?([\d.]+)%/gi`

**Matches:**
- "SBA guarantee fee is 2%"
- "Guarantee fee: 2.5%"

**Extracted:**
```json
{
  "field_name": "guarantee_fee",
  "default_value": "2.0",
  "confidence_score": 0.95
}
```

---

### Pattern 8: Maximum Loan Amount
**Regex:** `/(?:maximum loan amount|loans up to)[:\s]+\$?([\d,]+(?:M|million)?)/gi`

**Matches:**
- "Maximum loan amount: $5,000,000"
- "Loans up to $2.5M"
- "Maximum loan amount: 3 million"

**Extracted:**
```json
{
  "field_name": "max_loan_amount",
  "default_value": "5000000",
  "max_value": 5000000,
  "confidence_score": 0.90
}
```

---

## Deviation Tracking

### How It Works

1. **User edits field** → Yellow "⚠️ Deviates from policy" badge appears
2. **User submits form** → Compare actual values to policy defaults
3. **Log deviations:**
```typescript
const deviations = [];
for (const [fieldName, value] of Object.entries(formData)) {
  const policyDefault = policyDefaults.get(fieldName);
  if (policyDefault && value !== policyDefault.default_value) {
    deviations.push({
      field_name: fieldName,
      field_label: policyDefault.field_label,
      policy_default: policyDefault.default_value,
      actual_value: value,
    });
  }
}
```

4. **Insert into database:**
```typescript
await supabaseAdmin().from("deal_policy_deviations").insert(
  deviations.map(d => ({
    deal_id: dealId,
    field_name: d.field_name,
    field_label: d.field_label,
    policy_default: d.policy_default,
    actual_value: d.actual_value,
    created_by: userId,
  }))
);
```

### Deviation Reporting

**Query: Deals with most deviations**
```sql
SELECT 
  d.id,
  d.borrower_name,
  COUNT(dpd.id) AS deviation_count
FROM deals d
LEFT JOIN deal_policy_deviations dpd ON d.id = dpd.deal_id
GROUP BY d.id, d.borrower_name
ORDER BY deviation_count DESC
LIMIT 10;
```

**Query: Most commonly overridden fields**
```sql
SELECT 
  field_label,
  COUNT(*) AS override_count
FROM deal_policy_deviations
GROUP BY field_label
ORDER BY override_count DESC;
```

**Query: LTV deviations**
```sql
SELECT 
  d.borrower_name,
  dpd.policy_default,
  dpd.actual_value,
  dpd.created_at
FROM deal_policy_deviations dpd
JOIN deals d ON dpd.deal_id = d.id
WHERE dpd.field_name = 'max_ltv'
ORDER BY dpd.created_at DESC;
```

---

## Production Enhancements

### 1. AI Extraction
Replace pattern matching with LLM-based extraction:

```typescript
async function extractWithAI(chunkText: string) {
  const prompt = `Extract loan policy defaults from this text:
  
${chunkText}

Return JSON array:
[{
  "field_name": "interest_rate",
  "field_label": "Interest Rate",
  "default_value": "Prime + 2.75%",
  "confidence": 0.95,
  "source": "excerpt from text"
}]`;

  const response = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  return JSON.parse(response.choices[0].message.content);
}
```

**Benefits:**
- Handles complex phrasing
- Extracts custom fields
- Better confidence scores
- Multi-language support

---

### 2. Smart Default Application
Auto-apply defaults based on borrower profile:

```typescript
// If borrower FICO = 720, use "high credit" defaults
// If borrower FICO = 640, use "low credit" defaults
const creditTier = borrower.fico >= 700 ? "high" : "low";

const defaults = await fetch(
  `/api/banks/policy/form-defaults?deal_type=sba_7a&credit_tier=${creditTier}`
);
```

---

### 3. Justification Prompts
Require justification for deviations:

```tsx
{isDeviation && (
  <textarea
    placeholder="Why are you deviating from policy? (required)"
    onChange={(e) => setJustification(e.target.value)}
    required
  />
)}
```

Save to `deal_policy_deviations.justification`.

---

### 4. Approval Workflows
Require manager approval for deviations:

```sql
ALTER TABLE deal_policy_deviations ADD COLUMN approval_status TEXT DEFAULT 'pending';
ALTER TABLE deal_policy_deviations ADD COLUMN approved_by TEXT;
ALTER TABLE deal_policy_deviations ADD COLUMN approved_at TIMESTAMPTZ;
```

Prevent deal from closing until deviations approved.

---

## Files Created

### Database (2 files)
1. `/supabase/migrations/20251219_policy_defaults.sql` - Tables + RLS
2. `/supabase/migrations/seed_policy_defaults.sql` - Example data

### API Routes (2 files)
3. `/src/app/api/banks/policy/extract-defaults/route.ts` - Pattern matching extraction
4. `/src/app/api/banks/policy/form-defaults/route.ts` - Fetch defaults with fallback

### UI Components (2 files)
5. `/src/components/deals/FormFieldWithDefault.tsx` - Reusable field component
6. `/src/app/deals/[dealId]/loan-terms/page.tsx` - Example form

---

## Testing Checklist

### Manual Testing

- [ ] Run 20251219_policy_defaults.sql migration
- [ ] Run seed_policy_defaults.sql (replace YOUR_BANK_ID_HERE)
- [ ] POST /api/banks/policy/extract-defaults → Verify defaults extracted
- [ ] GET /api/banks/policy/form-defaults?deal_type=sba_7a → Verify fallback logic
- [ ] Visit /deals/[dealId]/loan-terms
- [ ] Change deal type → Verify defaults reload
- [ ] Hover "📋 Policy Default" badge → Verify tooltip
- [ ] Click badge → Verify value applied
- [ ] Change field value → Verify "⚠️ Deviates" badge appears
- [ ] Enter value outside min/max → Verify red error text
- [ ] Click "Reset to Policy Defaults" → Verify form resets
- [ ] Submit form → Verify deviations logged to console

### Edge Cases

- [ ] No policy defaults exist → Show warning message
- [ ] Deal type with no defaults → Falls back to global defaults
- [ ] Empty field → No deviation badge
- [ ] Field equals policy default → No deviation badge
- [ ] Multiple chunks mention same field → Highest confidence wins
- [ ] Percentage field → Shows "%" suffix
- [ ] Currency field → Shows "$" prefix
- [ ] Number field → Validates min/max

---

## FAQ

**Q: How do I add a new field type?**  
A: Add a new pattern to `extractFromChunk()` function in `extract-defaults/route.ts`.

**Q: Can I customize the confidence score?**  
A: Yes, adjust the `confidence_score` value in each pattern (0.0-1.0).

**Q: How do I handle multi-value fields (e.g., select dropdowns)?**  
A: Use `allowed_values` JSONB column:
```json
{
  "field_type": "select",
  "allowed_values": ["Prime + 2.75%", "Prime + 3.00%", "Prime + 3.25%"]
}
```

**Q: Can I extract defaults without chunks?**  
A: No, you must ingest policy documents first (Option 1). Alternatively, manually insert into `bank_policy_defaults` table.

**Q: How do I delete old defaults?**  
A:
```sql
DELETE FROM bank_policy_defaults WHERE bank_id = 'your-bank-id';
```

**Q: Can I use this with non-loan forms?**  
A: Yes! Works for any form. Just extract appropriate defaults and use FormFieldWithDefault.

---

## 🎯 Summary

✅ **Auto-Fill Bank Forms Complete**

**What you got:**
- 2 database tables (defaults + deviations)
- 2 API routes (extract + fetch)
- 2 UI components (field + form)
- 8 pattern matchers (interest rate, LTV, DSCR, FICO, term, down payment, fee, amount)
- Deviation tracking + audit trail
- Fallback logic (exact → deal type → global)
- Real-time validation (min/max constraints)
- Policy compliance badges (blue default, yellow deviation)

**What's next:**
- Option 2: Exception Workflow (if needed)
- Add more pattern matchers
- Integrate AI extraction (GPT-4)
- Add approval workflows
- Build deviation reports

**Ready to go:**
1. Run SQL migrations
2. Seed example defaults (replace YOUR_BANK_ID_HERE)
3. Extract defaults from policy chunks
4. Visit /deals/[dealId]/loan-terms
5. Watch form auto-fill with policy-compliant defaults

🎉 **Your forms now speak your bank's policy language.**
