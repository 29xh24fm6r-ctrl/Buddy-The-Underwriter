# Phase 81 — Classification Supremacy

**Status:** Spec ready for implementation  
**Scope:** 5 file edits — classification spine overhaul  
**Problem:** Document misclassification has been a persistent failure since day one.

---

## Root Cause Analysis (from full code audit)

Eight distinct failure modes were identified by reading every file in `src/lib/classification/`:

| # | Cause | File | Since |
|---|-------|------|-------|
| 1 | Tier 1 is first-match-wins, not best-match | tier1Anchors.ts | Day 1 |
| 2 | AnchorRule has no exclusion mechanism | types.ts | Day 1 |
| 3 | PFS has never existed in Tier 1 | tier1Anchors.ts | Day 1 |
| 4 | CREDIT_MEMO anchor searches firstTwoPages — wrong scope for 17-page docs | tier1Anchors.ts | Phase 80 |
| 5 | CREDIT_MEMO anchor positioned AFTER anchors it can conflict with | tier1Anchors.ts | Phase 80 |
| 6 | Tier 3 LLM prompt doesn't know about CREDIT_MEMO or COMMERCIAL_LEASE | tier3LLM.ts | Phase 80 |
| 7 | Tier 3 model falls back to gemini-2.0-flash (retired) | tier3LLM.ts | Day 1 |
| 8 | confusionExamples.json has 5 stale examples, none for new doc types | confusionExamples.json | Day 1 |

---

## The Core Architectural Flaw (Cause 1 + 2)

`runTier1Anchors` iterates `PRIORITY_SORTED_ANCHORS` and returns the FIRST anchor that fires.
There is no disambiguation when multiple anchors could match the same document.

**The OGB PFS failure:**
- The OGB Personal Financial Statement form contains a section literally titled "Section 3 – Balance Sheet"
- BALANCE_SHEET_STRUCTURAL fires on "balance sheet" + "total assets" + "total liabilities"
- Classification locks as BALANCE_SHEET before PFS is ever evaluated
- This has happened on EVERY OGB PFS since day one

**The Credit Memo failure:**
- Credit memos contain financial analysis tables (income, expenses, assets, liabilities)
- Those tables trigger INCOME_STMT_STRUCTURAL or BALANCE_SHEET_STRUCTURAL
- CREDIT_MEMO anchor is positioned after both of those in the array
- Additionally, the critical signals (DSCR, recommendation, collateral) are on pages 3-6, outside firstTwoPagesText

---

## The Fix — 5 Files

### Edit 1: `src/lib/classification/types.ts`

**Add two new optional fields to `AnchorRule`:**

Find the `AnchorRule` type and add after `secondaryMinMatch`:

```typescript
/**
 * Exclusion patterns — if ANY of these match the search text,
 * this anchor is suppressed even if primary + secondary patterns match.
 * Used to prevent false positives on documents with shared vocabulary.
 */
excludePatterns?: RegExp[];

/**
 * Search scope for this anchor.
 * "firstTwoPages" — searches firstTwoPagesText (~6000 chars). Default.
 * "fullText" — searches fullText. Use for multi-page docs where signals
 *              appear beyond page 2 (e.g., credit memos, appraisals).
 */
searchScope?: "firstTwoPages" | "fullText";
```

**Also bump the schema version:**

```typescript
export const CLASSIFICATION_SCHEMA_VERSION = "v2.2";
```

---

### Edit 2: `src/lib/classification/tier1Anchors.ts`

This is the most important edit. Four changes:

#### 2a — Update `matchAnchor` to support excludePatterns and searchScope

Replace the existing `matchAnchor` function with this version:

```typescript
function matchAnchor(
  rule: AnchorRule,
  doc: NormalizedDocument,
): EvidenceItem | null {
  // Resolve search text based on scope
  const searchText = rule.searchScope === "fullText"
    ? doc.fullText
    : rule.formNumber
      ? doc.fullText          // form number anchors always search fullText
      : doc.firstTwoPagesText; // structural anchors default to firstTwoPages

  const match = searchText.match(rule.pattern);
  if (!match) return null;

  // Check exclusion patterns — if any match, suppress this anchor
  if (rule.excludePatterns && rule.excludePatterns.length > 0) {
    for (const ep of rule.excludePatterns) {
      if (ep.test(searchText)) return null;
    }
  }

  // Check secondary patterns if present
  if (rule.secondaryPatterns && rule.secondaryPatterns.length > 0) {
    const minMatch = rule.secondaryMinMatch ?? rule.secondaryPatterns.length;
    let secondaryHits = 0;
    for (const sp of rule.secondaryPatterns) {
      if (sp.test(searchText)) secondaryHits++;
    }
    if (secondaryHits < minMatch) return null;
  }

  return {
    type: rule.formNumber ? "form_match" : "structural_match",
    anchorId: rule.anchorId,
    matchedText: match[0],
    confidence: rule.confidence,
  };
}
```

**IMPORTANT:** The old `matchAnchor(rule, text)` signature takes a string. The new one takes `(rule, doc)`. Update `runTier1Anchors` accordingly — pass `doc` instead of `searchText`.

#### 2b — Update `runTier1Anchors` to pass doc instead of text

Replace the loop inside `runTier1Anchors`:

```typescript
export function runTier1Anchors(doc: NormalizedDocument): Tier1Result {
  for (const rule of PRIORITY_SORTED_ANCHORS) {
    const evidence = matchAnchor(rule, doc);  // pass doc, not text

    if (evidence) {
      const formNumbers = extractFormNumbers(doc.fullText);
      const taxYear =
        rule.entityType === "personal" || rule.entityType === "business"
          ? extractTaxYear(doc.fullText)
          : null;

      return {
        matched: true,
        docType: rule.docType,
        confidence: rule.confidence,
        anchorId: rule.anchorId,
        evidence: [evidence],
        formNumbers: formNumbers.length > 0 ? formNumbers : null,
        taxYear,
        entityType: rule.entityType,
      };
    }
  }

  return {
    matched: false,
    docType: null,
    confidence: 0,
    anchorId: null,
    evidence: [],
    formNumbers: null,
    taxYear: null,
    entityType: null,
  };
}
```

#### 2c — Replace STRUCTURAL_ANCHORS with the corrected version

Replace the entire `STRUCTURAL_ANCHORS` array with this:

```typescript
const STRUCTURAL_ANCHORS: AnchorRule[] = [

  // ── PERSONAL FINANCIAL STATEMENT ────────────────────────────────────────
  // MUST come before BALANCE_SHEET_STRUCTURAL.
  // The OGB PFS form contains "Section 3 – Balance Sheet" as a section header,
  // which would trigger BALANCE_SHEET_STRUCTURAL without this guard.
  {
    anchorId: "PERSONAL_FINANCIAL_STMT_STRUCTURAL",
    pattern: /personal\s+financial\s+statement/i,
    docType: "PFS",
    confidence: 0.94,
    entityType: "personal",
    formNumber: null,
    secondaryPatterns: [
      /net\s+worth/i,
      /(?:total\s+assets|total\s+liabilities)/i,
    ],
    secondaryMinMatch: 2,
  },

  // ── CREDIT MEMO ─────────────────────────────────────────────────────────
  // MUST come before BALANCE_SHEET and INCOME_STATEMENT.
  // Credit memos contain financial analysis tables (assets, liabilities, revenue)
  // that would trigger those anchors if CREDIT_MEMO is positioned after them.
  // searchScope: "fullText" because DSCR, collateral, and recommendation language
  // typically appear on pages 3-6 of a 15-20 page credit memo, outside firstTwoPages.
  {
    anchorId: "CREDIT_MEMO_STRUCTURAL",
    pattern: /(?:loan\s+worksheet|officer\s+narrative|credit\s+memo(?:randum)?|credit\s+approval)/i,
    docType: "CREDIT_MEMO",
    confidence: 0.93,
    entityType: null,
    formNumber: null,
    searchScope: "fullText",
    secondaryPatterns: [
      /(?:debt\s+service\s+coverage|dscr)/i,
      /(?:collateral\s+description|collateral\s+offered)/i,
      /(?:recommend(?:ation)?|approve|approval)/i,
      /(?:loan\s+amount|loan\s+term|interest\s+rate)/i,
    ],
    secondaryMinMatch: 2,
  },

  // ── COMMERCIAL LEASE ────────────────────────────────────────────────────
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

  // ── BALANCE SHEET ───────────────────────────────────────────────────────
  // excludePatterns: suppressed when personal financial statement language
  // is present — prevents PFS from being locked as BALANCE_SHEET.
  // (Belt-and-suspenders: PERSONAL_FINANCIAL_STMT_STRUCTURAL fires first,
  // but this exclusion catches edge cases where OCR garbles the PFS header.)
  {
    anchorId: "BALANCE_SHEET_STRUCTURAL",
    pattern: /balance\s+sheet|statement\s+of\s+financial\s+position/i,
    docType: "BALANCE_SHEET",
    confidence: 0.93,
    entityType: null,
    formNumber: null,
    excludePatterns: [
      /personal\s+financial\s+statement/i,
      /statement\s+of\s+personal/i,
      /net\s+worth.*personal/i,
    ],
    secondaryPatterns: [/total\s+assets/i, /total\s+liabilities/i],
  },

  // ── INCOME STATEMENT ────────────────────────────────────────────────────
  {
    anchorId: "INCOME_STMT_STRUCTURAL",
    pattern: /income\s+statement|profit\s+and\s+loss|profit\s*&\s*loss|statement\s+of\s+operations|operating\s+results|income\s+summary/i,
    docType: "INCOME_STATEMENT",
    confidence: 0.92,
    entityType: null,
    formNumber: null,
    secondaryPatterns: [
      /(?:total\s+)?(?:revenue|sales|income)/i,
      /(?:total\s+)?(?:expenses?|operating\s+expenses?)/i,
      /net\s+(?:income|loss|profit)/i,
    ],
    secondaryMinMatch: 2,
  },

  // ── BANK STATEMENT ──────────────────────────────────────────────────────
  {
    anchorId: "BANK_STMT_STRUCTURAL",
    pattern: /(?:beginning|opening)\s+balance/i,
    docType: "BANK_STATEMENT",
    confidence: 0.91,
    entityType: null,
    formNumber: null,
    secondaryPatterns: [/(?:ending|closing)\s+balance/i],
  },
];
```

---

### Edit 3: `src/lib/classification/tier3LLM.ts`

Two changes:

#### 3a — Fix the model fallback

In `getClassifierModel()`, change the fallback:
```typescript
// BEFORE:
"gemini-2.0-flash"

// AFTER:
"gemini-2.5-flash"
```

#### 3b — Replace the SYSTEM_PROMPT constant

Replace the entire `SYSTEM_PROMPT` string with this:

```typescript
const SYSTEM_PROMPT = `You are a document classifier for a commercial bank underwriting pipeline.
Given a document (text), classify it into exactly one doc_type.
Return ONLY valid JSON matching the schema below.

DOCUMENT TYPES (choose the most specific match):
- IRS_BUSINESS: Business tax returns (Form 1120, 1120S, 1065 and schedules — NOT K-1)
- IRS_PERSONAL: Personal tax returns (Form 1040 and schedules — NOT K-1, NOT W-2, NOT 1099)
- PFS: Personal Financial Statement / SBA Form 413 — an INDIVIDUAL GUARANTOR'S personal assets, liabilities, and net worth. NOT a business balance sheet.
- RENT_ROLL: Rent roll / tenant list showing tenants, units, rents, expirations
- INCOME_STATEMENT: Income statement, P&L, operating statement, monthly financials
- BALANCE_SHEET: Balance sheet / statement of financial position for a BUSINESS ENTITY (not a person)
- BANK_STATEMENT: Bank account statement with transactions
- K1: Schedule K-1 (from 1065, 1120-S, or trust)
- W2: W-2 wage and tax statement
- 1099: 1099 form (any variant)
- DRIVERS_LICENSE: Government-issued photo ID
- ARTICLES: Articles of incorporation/organization
- OPERATING_AGREEMENT: LLC operating agreement
- INSURANCE: Insurance certificate or policy
- APPRAISAL: Property appraisal report
- COMMERCIAL_LEASE: Commercial lease agreement, lease amendment, NNN lease, or office/retail lease with a rent schedule and defined Landlord/Tenant parties
- CREDIT_MEMO: Internal bank credit memo, loan worksheet, officer narrative, or prior-approved credit package. Contains DSCR calculations, collateral descriptions, and a banker recommendation/approval section.
- OTHER: Cannot determine type

CRITICAL CONFUSION PAIRS (pay careful attention to these):

1. Form 1065 vs Schedule K-1:
   - Form 1065 is the PARTNERSHIP RETURN (IRS_BUSINESS)
   - Schedule K-1 is a PARTNER'S SHARE statement (K1)
   - "Schedule K-1 (Form 1065)" → K1, not IRS_BUSINESS

2. PFS vs BALANCE_SHEET:
   - PFS = personal individual guarantor document. Has: personal real estate, vehicles, retirement accounts, life insurance cash value, net worth, personal income/expenses. Titled "Personal Financial Statement."
   - BALANCE_SHEET = business entity document. Has: business equipment, accounts receivable, inventory, retained earnings. Titled with a company name.
   - KEY: A PFS may contain a section called "Balance Sheet" or "Statement of Financial Condition" — this does NOT make it a BALANCE_SHEET. Look at the overall document.
   - If the document mentions an individual by name with personal assets → PFS
   - If the document mentions a company name with business assets → BALANCE_SHEET

3. CREDIT_MEMO vs BALANCE_SHEET / INCOME_STATEMENT:
   - Credit memos contain financial analysis tables (income, expenses, assets) but that is NOT the document's primary purpose
   - Credit memos are identified by: "Loan Worksheet", "Officer Narrative", "DSCR", "Debt Service Coverage Ratio", "Collateral Description", "Recommendation", banker approval signatures
   - If you see DSCR calculations AND a banker recommendation → CREDIT_MEMO
   - Do not let the presence of financial tables override these primary signals

4. COMMERCIAL_LEASE vs OTHER:
   - Commercial leases have: defined Landlord and Tenant parties, a rent schedule with dollar amounts per period, commencement and expiration dates, lease term in months
   - "First Amendment to Lease", "NNN", "plus utilities" are strong lease signals
   - If a document has a rent table and defined Landlord/Tenant → COMMERCIAL_LEASE

5. YTD P&L vs Annual P&L:
   - Both → INCOME_STATEMENT. Not different types.

6. Bank Statement vs Transaction Export:
   - Both → BANK_STATEMENT

IMPORTANT: Do NOT classify any document as T12 or LEASE. Use INCOME_STATEMENT for P&L. Use COMMERCIAL_LEASE for leases.

CONFIDENCE RULES:
- 0.85+: High confidence (clear signals)
- 0.60-0.84: Moderate (some ambiguity)
- Below 0.60: Low (unclear)

Required JSON output:
{
  "doc_type": "IRS_BUSINESS",
  "confidence": 0.95,
  "reasoning": "Form 1120S visible on page 1",
  "anchor_evidence": ["Form 1120S header", "Tax year 2023"],
  "confusion_candidates": ["IRS_PERSONAL"],
  "tax_year": 2023,
  "entity_name": "ABC Corp",
  "entity_type": "business",
  "form_numbers": ["1120S"],
  "issuer": "IRS",
  "period_start": "2023-01-01",
  "period_end": "2023-12-31"
}`;
```

---

### Edit 4: `src/lib/classification/confusionExamples.json`

Replace the entire file with this expanded set:

```json
[
  {
    "original_type": "INCOME_STATEMENT",
    "corrected_type": "BALANCE_SHEET",
    "signals": [
      "document contains assets, liabilities, equity sections",
      "no revenue or expense line items",
      "header reads 'Statement of Financial Position'"
    ]
  },
  {
    "original_type": "INCOME_STATEMENT",
    "corrected_type": "RENT_ROLL",
    "signals": [
      "table lists unit numbers, tenant names, monthly rent",
      "columns include lease start/end dates",
      "no EBITDA or net income totals"
    ]
  },
  {
    "original_type": "IRS_PERSONAL",
    "corrected_type": "K1",
    "signals": [
      "header reads 'Schedule K-1' not Form 1040",
      "shows partner/shareholder share of income",
      "no standard deductions or personal exemptions"
    ]
  },
  {
    "original_type": "BALANCE_SHEET",
    "corrected_type": "PFS",
    "signals": [
      "titled 'Personal Financial Statement'",
      "lists personal real estate, vehicles, retirement accounts, life insurance cash value",
      "signed by individual — not a corporate officer signing on behalf of entity",
      "contains personal income and expense section",
      "has 'net worth' as primary bottom-line figure"
    ]
  },
  {
    "original_type": "IRS_PERSONAL",
    "corrected_type": "IRS_BUSINESS",
    "signals": [
      "Form 1120S or 1065 header present",
      "shows corporate or partnership income",
      "EIN present, not SSN"
    ]
  },
  {
    "original_type": "BALANCE_SHEET",
    "corrected_type": "CREDIT_MEMO",
    "signals": [
      "document is an internal bank loan worksheet or officer narrative",
      "contains DSCR (Debt Service Coverage Ratio) calculation",
      "has a 'Recommendation' or 'Approval' section with banker signatures",
      "financial tables are supporting analysis, not the primary content",
      "collateral description and LTV ratio present"
    ]
  },
  {
    "original_type": "INCOME_STATEMENT",
    "corrected_type": "CREDIT_MEMO",
    "signals": [
      "document contains 'Officer Narrative' or 'Executive Summary' section",
      "DSCR and annual debt service calculations present",
      "recommendation to approve or decline a loan request",
      "income statement data is embedded analysis, not the standalone document"
    ]
  },
  {
    "original_type": "OTHER",
    "corrected_type": "COMMERCIAL_LEASE",
    "signals": [
      "document defines Landlord and Tenant as named parties",
      "contains a rent schedule with monthly dollar amounts per period",
      "has commencement date and expiration date",
      "titled 'Lease Agreement', 'First Amendment to Lease', or similar",
      "'NNN' or 'plus utilities' language present"
    ]
  },
  {
    "original_type": "LEASE",
    "corrected_type": "COMMERCIAL_LEASE",
    "signals": [
      "this is the correct type — LEASE is deprecated, use COMMERCIAL_LEASE",
      "all lease documents should be classified as COMMERCIAL_LEASE"
    ]
  },
  {
    "original_type": "INCOME_STATEMENT",
    "corrected_type": "COMMERCIAL_LEASE",
    "signals": [
      "document has periodic payment table that looks like P&L",
      "but parties are named Landlord and Tenant, not income/expense categories",
      "dollar amounts represent rent payments, not revenue"
    ]
  },
  {
    "original_type": "PFS",
    "corrected_type": "BALANCE_SHEET",
    "signals": [
      "document is for a business entity, not an individual",
      "lists business equipment, accounts receivable, inventory",
      "retained earnings present instead of personal net worth",
      "no personal real estate or vehicles listed for an individual"
    ]
  },
  {
    "original_type": "BALANCE_SHEET",
    "corrected_type": "BALANCE_SHEET",
    "signals": [
      "NOTE: OGB Personal Financial Statement form has a section titled 'Section 3 – Balance Sheet'",
      "This does NOT make it a BALANCE_SHEET — look for 'Personal Financial Statement' in the header",
      "If the overall document header says 'Personal Financial Statement', classify as PFS"
    ]
  }
]
```

---

### Edit 5: `src/lib/classification/index.ts`

No changes needed here — verify it exports `classifyDocumentSpine`.

---

## Test Criteria

After implementation, the following documents must classify correctly:

| Document | Expected Type | Key Signals |
|----------|--------------|-------------|
| OGB Personal Financial Statement | PFS | "Personal Financial Statement" header despite containing "Section 3 – Balance Sheet" |
| OGB Loan Worksheet / Credit Memo | CREDIT_MEMO | "Loan Worksheet" header + DSCR + Recommendation |
| Road Star First Amendment to Lease | COMMERCIAL_LEASE | "Amendment to Lease" + Landlord/Tenant + rent schedule |
| Ellmann & Ellmann P&L (accrual) | INCOME_STATEMENT | Revenue/expenses/net income structure |
| BTR 2024 Ellmann | IRS_BUSINESS | Business tax return signals |
| PTR 2023 Ellmann | IRS_PERSONAL | Personal tax return signals |

## Schema Version

Bump `CLASSIFICATION_SCHEMA_VERSION` in `types.ts` to `"v2.2"` after all edits are complete.

## Implementation Notes

1. The `matchAnchor` function signature change (string → NormalizedDocument) is the only breaking change. The function is private to tier1Anchors.ts so no external callers are affected.

2. The `searchScope: "fullText"` on CREDIT_MEMO_STRUCTURAL is intentional and necessary. Credit memos are 15-20 pages. The firstTwoPagesText window (~6000 chars) catches the header but misses DSCR, collateral, and recommendation language on later pages.

3. The `excludePatterns` on BALANCE_SHEET_STRUCTURAL is belt-and-suspenders. The PFS anchor fires first, so BALANCE_SHEET should rarely reach excludePatterns check on a PFS document. But if OCR garbles the "Personal Financial Statement" header, the exclusion catches it.

4. Do NOT add filename-based classification at any tier. Filenames are untrusted client input. Architecture decision: classification must be content-based only.

5. TypeScript exhaustiveness: after adding `searchScope` and `excludePatterns` as optional fields to `AnchorRule`, no existing usage breaks since both are optional.
