# Phase 80 — Commercial Lease & Credit Memo Intelligence

**Status:** New files shipped. Existing file wiring required.
**Scope:** 4 surgical edits to existing files. No schema changes required.

---

## Background

Buddy currently cannot process commercial lease documents or prior bank credit
memos uploaded alongside new loan requests. This gap prevents correct underwriting
of investment property deals and repeat borrowers with existing debt service.

Three new files were added in commits c057ae4, f8be727, 68567f5:
- `src/lib/financialSpreads/extractors/deterministic/commercialLeaseExtractor.ts`
- `src/lib/financialSpreads/extractors/deterministic/creditMemoExtractor.ts`
- `src/lib/financialSpreads/yoyAnomalyDetector.ts`

This spec describes the 4 wiring changes needed in existing files.

---

## Edit 1 — `src/lib/classification/tier1Anchors.ts`

**Where:** Inside the `STRUCTURAL_ANCHORS` array, after the `BANK_STMT_STRUCTURAL` entry.

**Add these two entries:**

```typescript
  // --- v2.2 additions ---

  {
    anchorId: "COMMERCIAL_LEASE_STRUCTURAL",
    pattern: /(?:lease\s+agreement|amendment\s+to\s+lease|professional\s+office\s+lease|commercial\s+lease)/i,
    docType: "COMMERCIAL_LEASE",
    confidence: 0.93,
    entityType: null,
    formNumber: null,
    secondaryPatterns: [
      /(?:landlord|lessor)/i,
      /(?:tenant|lessee)/i,
      /(?:monthly\s+rent|annual\s+rent|\$[\d,]+\s*\/?\s*(?:mo|month|per\s+month))/i,
      /(?:commencement|lease\s+term|term\s+of\s+(?:this\s+)?lease)/i,
    ],
    secondaryMinMatch: 2,
  },

  {
    anchorId: "CREDIT_MEMO_STRUCTURAL",
    pattern: /(?:loan\s+worksheet|officer\s+narrative|credit\s+memo(?:randum)?|credit\s+approval)/i,
    docType: "CREDIT_MEMO",
    confidence: 0.93,
    entityType: null,
    formNumber: null,
    secondaryPatterns: [
      /(?:debt\s+service\s+coverage|dscr)/i,
      /(?:collateral\s+description|collateral\s+offered)/i,
      /(?:recommend(?:ation)?|approve|approval)/i,
      /(?:loan\s+amount|loan\s+term|interest\s+rate)/i,
    ],
    secondaryMinMatch: 2,
  },
```

**Why:** Without these anchors, the classifier falls through to Tier 3 LLM
which may misclassify lease amendments as INCOME_STATEMENT and credit memos
as BALANCE_SHEET. The deterministic anchors lock classification before LLM
is invoked.

---

## Edit 2 — `src/lib/financialSpreads/extractFactsFromDocument.ts`

**Where:** At the top of the file, add two new imports after the existing
deterministic extractor imports (around line 30):

```typescript
import { extractCommercialLeaseDeterministic } from "@/lib/financialSpreads/extractors/deterministic/commercialLeaseExtractor";
import { extractCreditMemoDeterministic } from "@/lib/financialSpreads/extractors/deterministic/creditMemoExtractor";
```

**Where:** After the `// ── Debt Schedule ──` block (around line 290),
add two new extractor blocks:

```typescript
  // ── Commercial Lease ───────────────────────────────────────────────────
  if (extractedText && normDocType === "COMMERCIAL_LEASE") {
    extractorRan = true;
    const gp = await attemptGeminiPrimary("COMMERCIAL_LEASE");
    if (gp.succeeded) {
      factsWritten += gp.factsWritten;
      extractionPath = "gemini_primary";
    } else {
      try {
        const result = await extractCommercialLeaseDeterministic(deterministicArgs);
        factsWritten += result.factsWritten;
        extractionPath = result.extractionPath;
      } catch (err) {
        console.error("[extractFactsFromDocument] commercialLease failed:", err);
      }
    }
  }

  // ── Credit Memo (prior loan / existing relationship) ───────────────────
  if (extractedText && normDocType === "CREDIT_MEMO") {
    extractorRan = true;
    const gp = await attemptGeminiPrimary("CREDIT_MEMO");
    if (gp.succeeded) {
      factsWritten += gp.factsWritten;
      extractionPath = "gemini_primary";
    } else {
      try {
        const result = await extractCreditMemoDeterministic(deterministicArgs);
        factsWritten += result.factsWritten;
        extractionPath = result.extractionPath;
      } catch (err) {
        console.error("[extractFactsFromDocument] creditMemo failed:", err);
      }
    }
  }
```

**Why:** Without these blocks, classified COMMERCIAL_LEASE and CREDIT_MEMO
documents skip all extractors, hit the EXTRACTION_ZERO_FACTS aegis warning,
and write nothing to deal_financial_facts.

---

## Edit 3 — `src/lib/financialSpreads/docTypeToSpreadTypes.ts`

**Where:** In the `spreadsForDocType` function, add before the final `return []`:

```typescript
  if (normDocType === "COMMERCIAL_LEASE") return ["RENT_ROLL"];
  // Credit memo facts feed GLOBAL_CASH_FLOW via PRIOR_TOTAL_ANNUAL_DS
  if (normDocType === "CREDIT_MEMO") return ["GLOBAL_CASH_FLOW"];
```

**Why:** Without this mapping, extraction of lease and credit memo facts does
not trigger spread recompute. The GLOBAL_CASH_FLOW spread needs to recompute
when a credit memo is uploaded so prior debt service is included in stacking.

---

## Edit 4 — `src/lib/sbaKnowledge/sopReferences.ts`

**Where:** Add to the `SOP_REFS` object:

```typescript
  SBA_504_OWNER_OCCUPIED_REQUIRED: {
    code: "SBA_504_OWNER_OCCUPIED_REQUIRED",
    title: "SBA 504 owner-occupancy requirement",
    citation: "SOP 50 10 7.1, Subpart B, Chapter 4, Section B — 504 Eligibility",
    url: "https://www.sba.gov/document/sop-50-10",
  },

  SBA_504_INVESTMENT_PROPERTY_INELIGIBLE: {
    code: "SBA_504_INVESTMENT_PROPERTY_INELIGIBLE",
    title: "Investment properties are ineligible for SBA 504",
    citation: "SOP 50 10 7.1, Subpart B, Chapter 4 — the 504 program requires at least 51% owner-occupancy by the operating company",
  },
```

**Why:** When LEASE_SBA504_ELIGIBLE = "false" is extracted from a commercial
lease, the policy engine needs a canonical SOP reference to cite in the
deal intelligence narrative and cockpit flag.

---

## Integration Test — Ellmann Suite 100 Deal

After wiring is complete, upload these three documents to a new deal:
1. `EXECUTED_Ellman_Credit_memo.pdf` → should classify as CREDIT_MEMO
2. `P_L_Accrual_2025_Ellmann.pdf` → should classify as INCOME_STATEMENT
3. `Road_Star_Driving_-_FIRST_AMENDMENT_-_7_2_24.pdf` → should classify as COMMERCIAL_LEASE

**Expected facts written:**
- CREDIT_MEMO: PRIOR_TOTAL_ANNUAL_DS = $93,060, EXISTING_RELATIONSHIP = "true", PRIOR_LOAN_PROGRAM = "SBA_504"
- COMMERCIAL_LEASE: LEASE_TENANT_NAME = "Road Star Driving CS", LEASE_MONTHLY_RENT_CURRENT = $3,884.83, LEASE_EXPIRATION_DATE = "2028-07-31", LEASE_OCCUPANCY_TYPE = "INVESTMENT_PROPERTY", LEASE_SBA504_ELIGIBLE = "false"
- INCOME_STATEMENT: Total Revenue = $516,389.50, Net Income = $93,318.80
- YOY anomaly: Rent line CRITICAL (2024→2025: +113%)

**Expected deal intelligence flags:**
- ⚠️  SBA_504_INVESTMENT_PROPERTY_INELIGIBLE (cite SOP)
- ⚠️  EXISTING_OGB_RELATIONSHIP — prior $625K loan on Suite 200 with $93,060 ADS
- 🔴  YOY_ANOMALY: Rent $74,455 → $158,900 (+113%) — requires LO explanation
- ℹ️  THIRD_PARTY_LEASE: Road Star Driving CS through 7/31/2028 at $3,885/mo

---

## No Schema Changes Required

All new facts use existing `deal_financial_facts` columns:
- `fact_type`: "COMMERCIAL_LEASE" or "CREDIT_MEMO" (new enum values — verify constraint)
- `fact_key`: new keys per the extractor files
- `fact_value_num` / `fact_value_text`: per key
- `confidence`, `provenance`: populated by extractors

**Action required:** Verify `fact_type` column accepts arbitrary string values
(check if it is an enum with a constraint). If so, add a migration to add
"COMMERCIAL_LEASE" and "CREDIT_MEMO" to the allowed values.

Check: `supabase/migrations/` for the deal_financial_facts table DDL.
