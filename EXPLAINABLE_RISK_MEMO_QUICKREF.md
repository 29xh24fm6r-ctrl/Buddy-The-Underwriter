# Explainable Risk → Memo Pipeline — Quick Reference

## Current State

✅ **Working Features:**
- Generate Risk (AI) - creates drivers with evidence
- Generate Memo (AI) - creates sections with citations
- Evidence chips show document + page references
- All data stored in-memory (no DB required)
- Zero external dependencies (stub AI provider)

---

## User Flow

### Step 1: Generate Risk
```
Navigate: /deals/:id/risk
Click: "Generate Risk (AI)"
Result: Page reloads with:
  - Risk grade: B+
  - Pricing: SOFR + 650 (Base 450 + Premium 200)
  - 4 drivers (cashflow, volatility, collateral, concentration)
  - 3 pricing adders with evidence chips
```

### Step 2: Generate Memo
```
Navigate: /deals/:id/memo
Click: "Generate Memo (AI)" (enabled after risk exists)
Result: Page reloads with:
  - 6 memo sections
  - Citations in each section
  - Linked to risk run ID
```

---

## Architecture Quick Map

### Data Flow
```
User → Server Action → AI Provider → DB Layer → Page Refresh
```

### File Structure
```
src/
├── lib/
│   ├── evidence/
│   │   └── types.ts              # EvidenceRef contract
│   ├── ai/
│   │   └── provider.ts           # AIProvider interface + StubProvider
│   └── db/
│       └── server.ts             # In-memory DB (ready for Supabase swap)
└── app/deals/[dealId]/
    ├── _actions/
    │   └── aiActions.ts          # generateRisk/Memo server actions
    └── (shell)/
        ├── risk/page.tsx         # Risk UI with drivers + pricing
        └── memo/page.tsx         # Memo UI with sections + citations
```

---

## Upgrade Paths (Choose Your Adventure)

### A) 🔥 **OpenAI Integration** (Real AI)

**Why:** Replace deterministic stub with real model
**Effort:** 2-3 hours
**Value:** Production-ready AI analysis

**Steps:**
1. Create `src/lib/ai/openai-provider.ts`
2. Implement `OpenAIProvider implements AIProvider`
3. Use structured outputs:
   ```typescript
   const completion = await openai.chat.completions.create({
     model: "gpt-4o",
     messages: [
       { role: "system", content: riskPrompt },
       { role: "user", content: JSON.stringify(input) }
     ],
     response_format: { type: "json_object" }
   });
   ```
4. Update `src/lib/ai/provider.ts`:
   ```typescript
   export function getAIProvider(): AIProvider {
     return new OpenAIProvider(); // ← ONE LINE CHANGE
   }
   ```

**Template prompt (Risk):**
```
You are a commercial credit analyst. Given deal snapshot and evidence index,
output risk factors with contributions, confidence, and evidence references.

Output JSON schema:
{
  grade: string,
  baseRateBps: number,
  riskPremiumBps: number,
  pricingExplain: [...],
  factors: [...]
}
```

---

### B) 🎯 **Citation Deep-Linking** (Click → View Evidence)

**Why:** Make evidence chips actionable
**Effort:** 1-2 hours
**Value:** Instant trust + auditor-friendly

**Steps:**
1. Add click handler to `EvidenceChips` component:
   ```typescript
   onClick={() => openPdfViewer(e.sourceId, e.page, e.bbox)}
   ```
2. Wire to existing PdfEvidenceSpansViewer (if you have it)
3. Or create simple modal:
   ```typescript
   <Dialog open={viewerOpen}>
     <iframe src={`/api/documents/${sourceId}#page=${page}`} />
   </Dialog>
   ```

**Bonus:** Highlight bbox with overlay
```typescript
<div className="absolute" style={{
  left: `${bbox.x * 100}%`,
  top: `${bbox.y * 100}%`,
  width: `${bbox.w * 100}%`,
  height: `${bbox.h * 100}%`,
  border: '2px solid yellow'
}} />
```

---

### C) 💾 **Real Database Persistence** (Supabase/Postgres)

**Why:** Persistent storage, multi-tenant support
**Effort:** 1 hour
**Value:** Production data integrity

**Steps:**
1. Run migration:
   ```bash
   psql $DATABASE_URL -f supabase/migrations/20251227000000_explainable_risk_memo.sql
   ```

2. Replace `src/lib/db/server.ts` with Supabase queries:
   ```typescript
   import { supabaseAdmin } from "@/lib/supabase/admin";

   export async function insertRiskRun(dealId: string, input: any, output: RiskOutput) {
     const sb = supabaseAdmin();
     const { data, error } = await sb
       .from('risk_runs')
       .insert({
         deal_id: dealId,
         inputs: input,
         outputs: output,
       })
       .select()
       .single();
     
     if (error) throw error;
     return data;
   }

   export async function getLatestRiskRun(dealId: string) {
     const sb = supabaseAdmin();
     const { data } = await sb
       .from('risk_runs')
       .select('*')
       .eq('deal_id', dealId)
       .order('created_at', { ascending: false })
       .limit(1)
       .single();
     
     return data;
   }
   ```

3. Add tenant checks:
   ```typescript
   import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
   
   const bankId = await getCurrentBankId();
   // Add bank_id to tables + RLS policies
   ```

---

### D) 📊 **Real Deal Fetch** (Replace Mock Snapshot)

**Why:** Use actual deal data
**Effort:** 30 mins
**Value:** Correct borrower names, amounts, terms

**Steps:**
Replace in `src/app/deals/[dealId]/_actions/aiActions.ts`:

```typescript
// OLD:
const dealSnapshot = {
  borrowerName: "Acme Logistics LLC",
  // ... mock data
};

// NEW:
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

const sb = supabaseAdmin();
const bankId = await getCurrentBankId();
const { data: deal } = await sb
  .from('deals')
  .select('*')
  .eq('id', dealId)
  .eq('bank_id', bankId)
  .single();

const dealSnapshot = {
  borrowerName: deal.borrower_name,
  industry: deal.industry,
  requestAmount: deal.request_amount,
  term: deal.term_months,
  collateral: deal.collateral_description,
  facilityType: deal.facility_type,
  yearsInBusiness: deal.years_in_business,
};
```

---

### E) 📄 **Real Evidence Index** (Uploaded Documents)

**Why:** Link to actual documents, not mocks
**Effort:** 1 hour
**Value:** True evidence traceability

**Steps:**
Replace in `aiActions.ts`:

```typescript
// OLD:
const evidenceIndex = [
  { docId: "doc-bank-statements", label: "Bank Statements (mock)", kind: "pdf" },
  // ...
];

// NEW:
const { data: docs } = await sb
  .from('deal_documents')
  .select('id, display_name, mime_type')
  .eq('deal_id', dealId)
  .eq('bank_id', bankId);

const evidenceIndex = docs.map(d => ({
  docId: d.id,
  label: d.display_name,
  kind: d.mime_type.startsWith('application/pdf') ? 'pdf' : 'text',
}));
```

---

### F) 🔄 **"What Changed?" Diff** (Risk Run Comparison)

**Why:** Show deltas when regenerating risk
**Effort:** 2 hours
**Value:** Track how analysis evolves

**UI:**
```typescript
Previous risk: B  →  Current risk: B+  ✅ Upgraded

Drivers changed:
  Cashflow coverage: +0.5 → +0.6  ✅ Improved
  Revenue volatility: -0.5 → -0.4  ✅ Less severe
  Collateral quality: +0.3 → +0.3  (unchanged)
```

**Implementation:**
1. Fetch previous risk run (2nd most recent)
2. Compare `factors` arrays by label
3. Show delta in contribution, confidence
4. Highlight added/removed factors

---

### G) 💬 **Credit Committee Chat** (Ask Questions)

**Why:** Interactive explainability
**Effort:** 3-4 hours
**Value:** Live Q&A with citations

**Example:**
```
User: "Why is the premium +200 bps?"
AI: "The risk premium consists of three adders:
     • Revenue volatility (+75 bps) [Bank statements · p.3]
     • Customer concentration (+50 bps) [A/R aging · p.1]
     • Collateral haircut (+75 bps) [Inventory report · p.2]"
```

**Implementation:**
1. Add chat UI to risk/memo page
2. Load latest risk run as context
3. OpenAI call with system prompt:
   ```
   You are a credit analyst. Answer questions about this risk analysis.
   Always cite evidence using [Document · p.X] format.
   ```
4. Stream response with citations

---

## Testing Checklist

### Manual Test Flow
```bash
# 1. Start dev server
npm run dev

# 2. Navigate to deal
open http://localhost:3000/deals/test-deal-123

# 3. Click "Risk & Pricing" in left rail
# 4. Click "Generate Risk (AI)"
# 5. Verify:
#    - Risk grade appears
#    - 4 drivers show with evidence chips
#    - 3 pricing adders show with rationale

# 6. Click "Credit Memo" in left rail
# 7. Click "Generate Memo (AI)"
# 8. Verify:
#    - 6 sections appear
#    - Citations show in each section
#    - Memo run ID + risk run ID displayed
```

### Edge Cases
- [x] Generate memo without risk → shows error
- [x] Evidence chips with no page → shows label only
- [x] Multiple evidence refs → shows up to 4/6 chips
- [x] Long rationale text → wraps correctly
- [ ] Regenerate risk → new run ID appears
- [ ] Multiple deals → data isolated per deal

---

## Performance Notes

### Current (In-Memory)
- **Risk generation:** ~10ms (deterministic)
- **Memo generation:** ~10ms (deterministic)
- **Page load:** Instant (no DB queries)

### With OpenAI
- **Risk generation:** ~2-5s (API latency)
- **Memo generation:** ~3-8s (longer text)
- **Page load:** Same (data cached from previous gen)

### With Database
- **Risk generation:** +50ms (DB insert)
- **Memo generation:** +100ms (DB inserts for sections)
- **Page load:** +50ms (fetch latest run)

---

## Common Issues

### Issue: "No risk run found" when memo exists
**Fix:** Risk run deleted or different dealId
**Solution:** Regenerate risk first

### Issue: Evidence chips not clickable
**Expected:** Not implemented yet (upgrade B)
**Solution:** Add click handlers + viewer modal

### Issue: TypeScript error on `risk.factors`
**Cause:** Stale type inference
**Solution:** Restart TS server or add explicit type:
```typescript
const risk = latest?.outputs as RiskOutput | null;
```

---

## Next Big Features (Post-Launch)

### 1. Multi-Model Ensemble
Run 3 AI providers (OpenAI, Anthropic, Gemini), show consensus + disagreements

### 2. Sensitivity Analysis
"What if cashflow drops 20%?" → recalculate grade + pricing

### 3. Batch Risk Scoring
Score entire portfolio overnight, flag deteriorating credits

### 4. Memo Export
Download PDF with citations intact (hyperlinks to evidence)

### 5. Audit Trail
Full lineage: risk run → memo run → PDF export → committee approval

---

**Pick your next upgrade and say the word. I'll spec it out.**

Options:
- A) OpenAI Integration
- B) Citation Deep-Linking  
- C) Real Database
- D) Real Deal Fetch
- E) Real Evidence Index
- F) Risk Run Diff
- G) Committee Chat

Or combine: **"A + B + C"** for full production-ready system.
