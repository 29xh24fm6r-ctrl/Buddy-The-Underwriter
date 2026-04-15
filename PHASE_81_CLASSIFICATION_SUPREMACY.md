# Phase 81 — Classification Supremacy

**Status:** Spec ready for implementation
**Scope:** 5 file edits
**Problem:** Document misclassification has been a persistent failure since day one.

---

## What Was Audited

Every file in `src/lib/classification/` was read, plus `src/lib/documents/docTypeRouting.ts`. The
analysis below reflects the **actual current state of main** — not assumptions.

---

## Root Cause Analysis

| # | Cause | File | Confirmed in code |
|---|-------|------|-------------------|
| 1 | PFS has never existed in Tier 1 — only in Tier 2 | tier1Anchors.ts | `STRUCTURAL_ANCHORS` has no PFS entry |
| 2 | `AnchorRule` has no `excludePatterns` field | types.ts | Field absent from type |
| 3 | CREDIT_MEMO_STRUCTURAL searches `firstTwoPagesText` | tier1Anchors.ts | `formNumber: null` → `doc.firstTwoPagesText` branch in `runTier1Anchors` |
| 4 | CREDIT_MEMO_STRUCTURAL positioned AFTER BALANCE_SHEET and INCOME_STMT | tier1Anchors.ts | Array order: BS → IS → BANK → COMMERCIAL_LEASE → **CREDIT_MEMO** |
| 5 | Tier 3 model falls back to `gemini-2.0-flash` (retired) | tier3LLM.ts | `getClassifierModel()` fallback confirmed |
| 6 | Tier 3 SYSTEM_PROMPT uses `LEASE` not `COMMERCIAL_LEASE`, no `CREDIT_MEMO` | tier3LLM.ts | Prompt text confirmed |
| 7 | `confusionExamples.json` has 5 examples, none for CREDIT_MEMO or COMMERCIAL_LEASE | confusionExamples.json | File contents confirmed |
| 8 | `docTypeRouting.ts` has no mapping for CREDIT_MEMO or COMMERCIAL_LEASE | docTypeRouting.ts | Neither appears in `normalizeToExtendedCanonical` or `ExtendedCanonicalType` |

### The OGB PFS failure (Cause 1 + 2)

The OGB Personal Financial Statement form contains a section literally titled
"Section 3 – Balance Sheet" with "total assets" and "total liabilities" rows.
`BALANCE_SHEET_STRUCTURAL` fires on this. Since PFS has no Tier 1 anchor, the document
is locked as BALANCE_SHEET before PFS is ever evaluated. This has happened on every
OGB PFS since day one.

**Fix:** Add `PERSONAL_FINANCIAL_STMT_STRUCTURAL` to `STRUCTURAL_ANCHORS` **before**
`BALANCE_SHEET_STRUCTURAL`, and add `excludePatterns` to `BALANCE_SHEET_STRUCTURAL`
as belt-and-suspenders.

### The Credit Memo failure (Causes 3 + 4)

`CREDIT_MEMO_STRUCTURAL` has `formNumber: null`. In `runTier1Anchors`, the search text
is selected as `rule.formNumber ? doc.fullText : doc.firstTwoPagesText`. So CREDIT_MEMO
searches only the first ~6000 chars. For a 17-page OGB loan worksheet, DSCR calculations
and the recommendation section are on pages 3–6 — outside that window.

Additionally, the anchor is positioned last in `STRUCTURAL_ANCHORS`, after
`BALANCE_SHEET_STRUCTURAL` and `INCOME_STMT_STRUCTURAL`. Financial tables in credit memos
fire those anchors first.

**Fix:** Add `searchScope: "fullText"` to the anchor rule and respect it in
`runTier1Anchors`. Move CREDIT_MEMO_STRUCTURAL to position 2 (after PFS, before
BALANCE_SHEET).

### The downstream routing gap (Cause 8)

`docTypeRouting.ts` → `normalizeToExtendedCanonical()` has no case for `CREDIT_MEMO`
or `COMMERCIAL_LEASE`. Both fall through to `return "OTHER"`. This means any document
classified as `CREDIT_MEMO` or `COMMERCIAL_LEASE` in the AI tier is stored with
`canonical_type = "OTHER"` in the `orchestrateIntake` code path — losing the
classification. `ExtendedCanonicalType` also lacks both types.

Note: `resolveChecklistKey("CREDIT_MEMO")` already returns `null` (Phase 72 fix) so
CREDIT_MEMO docs will not trigger the reconcile invariant regardless of canonical_type.
But the type should still round-trip correctly.

---

## The Fix — 5 Files

---

### Edit 1: `src/lib/classification/types.ts`

**1a — Add two optional fields to `AnchorRule`, after `secondaryMinMatch`:**

```typescript
// BEFORE (end of AnchorRule type):
  /** Minimum number of secondary patterns that must match (default: all) */
  secondaryMinMatch?: number;
};

// AFTER:
  /** Minimum number of secondary patterns that must match (default: all) */
  secondaryMinMatch?: number;
  /**
   * Exclusion patterns — if ANY of these match the search text,
   * this anchor is suppressed even if primary + secondary patterns match.
   * Used to prevent false positives on documents with shared vocabulary.
   */
  excludePatterns?: RegExp[];
  /**
   * Search scope for this anchor.
   * "firstTwoPages" — searches firstTwoPagesText (~6000 chars). Default.
   * "fullText"      — searches fullText. Required for multi-page docs where
   *                   key signals appear beyond page 2 (e.g. credit memos).
   */
  searchScope?: "firstTwoPages" | "fullText";
};
```

**1b — Bump schema version:**

```typescript
// BEFORE:
export const CLASSIFICATION_SCHEMA_VERSION = "v2.1";

// AFTER:
export const CLASSIFICATION_SCHEMA_VERSION = "v2.2";
```

---

### Edit 2: `src/lib/classification/tier1Anchors.ts`

Three sub-changes. Read the file first, then apply all three atomically.

#### 2a — Update `matchAnchor` to support `excludePatterns`

The function signature stays `(rule: AnchorRule, text: string)` — do NOT change
the signature. Add exclusion check after the primary pattern match:

```typescript
// BEFORE:
function matchAnchor(
  rule: AnchorRule,
  text: string,
): EvidenceItem | null {
  const match = text.match(rule.pattern);
  if (!match) return null;

  // Check secondary patterns if present
  if (rule.secondaryPatterns && rule.secondaryPatterns.length > 0) {

// AFTER:
function matchAnchor(
  rule: AnchorRule,
  text: string,
): EvidenceItem | null {
  const match = text.match(rule.pattern);
  if (!match) return null;

  // Check exclusion patterns — if any match, suppress this anchor
  if (rule.excludePatterns && rule.excludePatterns.length > 0) {
    for (const ep of rule.excludePatterns) {
      if (ep.test(text)) return null;
    }
  }

  // Check secondary patterns if present
  if (rule.secondaryPatterns && rule.secondaryPatterns.length > 0) {
```

#### 2b — Update `runTier1Anchors` to respect `searchScope`

The existing search text selection is:
```typescript
const searchText = rule.formNumber ? doc.fullText : doc.firstTwoPagesText;
```

Replace with:
```typescript
const searchText =
  rule.searchScope === "fullText"
    ? doc.fullText
    : rule.formNumber
      ? doc.fullText
      : doc.firstTwoPagesText;
```

The full updated loop looks like this (only the `searchText` line changes):
```typescript
  for (const rule of PRIORITY_SORTED_ANCHORS) {
    const searchText =
      rule.searchScope === "fullText"
        ? doc.fullText
        : rule.formNumber
          ? doc.fullText
          : doc.firstTwoPagesText;
    const evidence = matchAnchor(rule, searchText);
```

#### 2c — Replace the entire `STRUCTURAL_ANCHORS` array

Replace everything from `const STRUCTURAL_ANCHORS: AnchorRule[] = [` through
the matching `];` with this:

```typescript
const STRUCTURAL_ANCHORS: AnchorRule[] = [

  // ── PERSONAL FINANCIAL STATEMENT ────────────────────────────────────────
  // MUST come before BALANCE_SHEET_STRUCTURAL.
  // The OGB PFS form contains "Section 3 – Balance Sheet" as a section header
  // with "total assets" and "total liabilities" rows — exactly what
  // BALANCE_SHEET_STRUCTURAL fires on. Without this anchor firing first,
  // every OGB PFS is misclassified as BALANCE_SHEET.
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
  // Credit memos contain financial analysis tables (assets, liabilities,
  // revenue, expenses) that trigger those anchors if CREDIT_MEMO is
  // positioned after them.
  //
  // searchScope: "fullText" is required. Credit memos are 15–20 pages.
  // The firstTwoPagesText window (~6000 chars) reaches the cover and
  // executive summary, but DSCR calculations, collateral description, and
  // the banker recommendation section appear on pages 3–6.
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
  // excludePatterns: belt-and-suspenders against the OGB PFS failure mode.
  // PERSONAL_FINANCIAL_STMT_STRUCTURAL fires first so BALANCE_SHEET_STRUCTURAL
  // should not reach a PFS document. But if OCR garbles the PFS header,
  // the exclusion catches it.
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
    // Both secondary patterns required (default: all)
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
    // Ending balance required (default: all)
  },
];
```

---

### Edit 3: `src/lib/classification/tier3LLM.ts`

Two changes:

#### 3a — Fix the retired model fallback

```typescript
// BEFORE:
    process.env.GEMINI_CLASSIFIER_MODEL ||
    process.env.GEMINI_MODEL ||
    "gemini-2.0-flash"

// AFTER:
    process.env.GEMINI_CLASSIFIER_MODEL ||
    process.env.GEMINI_MODEL ||
    "gemini-2.5-flash"
```

#### 3b — Replace the SYSTEM_PROMPT constant

Replace the entire `const SYSTEM_PROMPT = \`...\`` string (from the backtick open
through the closing backtick) with this:

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
   - KEY: A PFS may contain a section called "Balance Sheet" or "Statement of Financial Condition" — this does NOT make it a BALANCE_SHEET. Look at the overall document header.
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

Replace the entire file contents with this:

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
      "LEASE is a deprecated type — always use COMMERCIAL_LEASE",
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
    "corrected_type": "PFS",
    "signals": [
      "NOTE: OGB Personal Financial Statement form has a section titled 'Section 3 – Balance Sheet'",
      "This does NOT make it a BALANCE_SHEET — look for 'Personal Financial Statement' in the document header",
      "If the overall document header says 'Personal Financial Statement', classify as PFS"
    ]
  }
]
```

---

### Edit 5: `src/lib/documents/docTypeRouting.ts`

Three sub-changes to this file. Read it first.

#### 5a — Add to `ExtendedCanonicalType` union

```typescript
// BEFORE:
export type ExtendedCanonicalType =
  | "BUSINESS_TAX_RETURN"
  | "PERSONAL_TAX_RETURN"
  | "INCOME_STATEMENT"
  | "BALANCE_SHEET"
  | "PFS"
  | "FINANCIAL_STATEMENT"
  | "BANK_STATEMENT"
  | "RENT_ROLL"
  | "LEASE"
  | "INSURANCE"
  | "APPRAISAL"
  | "ENTITY_DOCS"
  | "DEBT_SCHEDULE"
  | "OTHER";

// AFTER:
export type ExtendedCanonicalType =
  | "BUSINESS_TAX_RETURN"
  | "PERSONAL_TAX_RETURN"
  | "INCOME_STATEMENT"
  | "BALANCE_SHEET"
  | "PFS"
  | "FINANCIAL_STATEMENT"
  | "BANK_STATEMENT"
  | "RENT_ROLL"
  | "LEASE"
  | "COMMERCIAL_LEASE"
  | "CREDIT_MEMO"
  | "INSURANCE"
  | "APPRAISAL"
  | "ENTITY_DOCS"
  | "DEBT_SCHEDULE"
  | "OTHER";
```

#### 5b — Add normalization cases in `normalizeToExtendedCanonical`

Add before the final `return "OTHER"`:

```typescript
// BEFORE (end of function):
  return "OTHER";
}

// AFTER:
  if (upper === "COMMERCIAL_LEASE" || upper === "LEASE_AGREEMENT")
    return "COMMERCIAL_LEASE";

  if (["CREDIT_MEMO", "LOAN_WORKSHEET", "OFFICER_NARRATIVE"].includes(upper))
    return "CREDIT_MEMO";

  return "OTHER";
}
```

Note: the existing `if (upper === "LEASE") return "LEASE"` line stays unchanged —
`LEASE` remains its own type for backward compat with older deal_documents rows.

#### 5c — Add to `ROUTING_CLASS_MAP`

```typescript
// BEFORE:
  // GEMINI_STANDARD: Standard single-pass OCR
  RENT_ROLL: "GEMINI_STANDARD",
  LEASE: "GEMINI_STANDARD",

// AFTER:
  // GEMINI_STANDARD: Standard single-pass OCR
  RENT_ROLL: "GEMINI_STANDARD",
  LEASE: "GEMINI_STANDARD",
  COMMERCIAL_LEASE: "GEMINI_STANDARD",
  CREDIT_MEMO: "GEMINI_STANDARD",
```

---

## Implementation Notes

1. **No signature change to `matchAnchor`.** The function stays `(rule: AnchorRule, text: string)`.
   The original spec incorrectly proposed changing it to take `NormalizedDocument`. That's
   unnecessary — `runTier1Anchors` already handles text selection before calling `matchAnchor`.

2. **CREDIT_MEMO_STRUCTURAL already existed** in the Phase 80 code. Edit 2c replaces the
   entire `STRUCTURAL_ANCHORS` array. Do not attempt a targeted patch — replace the whole block
   to ensure correct ordering.

3. **`searchScope: "fullText"`** on `CREDIT_MEMO_STRUCTURAL` works because Edit 2b adds the
   scope check in `runTier1Anchors`. Without Edit 2b, the field would be silently ignored.

4. **`resolveChecklistKey("CREDIT_MEMO")` returns `null`** (Phase 72 fix). Adding CREDIT_MEMO
   to `docTypeRouting.ts` does NOT re-introduce the Phase 72 invariant. The reconcile check
   only fires when `resolveChecklistKey` returns a non-null key — which it no longer does for
   CREDIT_MEMO.

5. **TypeScript**: After adding `COMMERCIAL_LEASE` and `CREDIT_MEMO` to `ExtendedCanonicalType`,
   TypeScript will require both to appear in `ROUTING_CLASS_MAP`. Edit 5c satisfies this.
   Run `npx tsc --noEmit` after all edits to confirm 0 errors.

6. **Do NOT add filename-based classification at any tier.** Filenames are untrusted client
   input. Classification must be content-based only.

---

## Verification Checklist

After all 5 edits, Claude Code must confirm:

- [ ] `CLASSIFICATION_SCHEMA_VERSION` is `"v2.2"` in `types.ts`
- [ ] `AnchorRule` type has `excludePatterns?: RegExp[]` and `searchScope?: "firstTwoPages" | "fullText"`
- [ ] `matchAnchor(rule, text: string)` — signature unchanged, but now checks `rule.excludePatterns`
- [ ] `runTier1Anchors` selects search text using `rule.searchScope === "fullText"` check
- [ ] `STRUCTURAL_ANCHORS` array order: PFS → CREDIT_MEMO → COMMERCIAL_LEASE → BALANCE_SHEET → INCOME_STMT → BANK_STMT
- [ ] `CREDIT_MEMO_STRUCTURAL` has `searchScope: "fullText"`
- [ ] `BALANCE_SHEET_STRUCTURAL` has `excludePatterns` array
- [ ] `PERSONAL_FINANCIAL_STMT_STRUCTURAL` is in the array (it was not there before)
- [ ] `tier3LLM.ts` fallback is `"gemini-2.5-flash"` not `"gemini-2.0-flash"`
- [ ] `SYSTEM_PROMPT` contains `COMMERCIAL_LEASE` and `CREDIT_MEMO` as doc types
- [ ] `SYSTEM_PROMPT` does NOT contain `LEASE` as a standalone doc type
- [ ] `confusionExamples.json` has 12 examples (was 5)
- [ ] `ExtendedCanonicalType` includes `COMMERCIAL_LEASE` and `CREDIT_MEMO`
- [ ] `normalizeToExtendedCanonical("CREDIT_MEMO")` returns `"CREDIT_MEMO"`
- [ ] `normalizeToExtendedCanonical("COMMERCIAL_LEASE")` returns `"COMMERCIAL_LEASE"`
- [ ] `ROUTING_CLASS_MAP` has entries for both
- [ ] `npx tsc --noEmit` — 0 new errors

---

## Test Criteria

After implementation, the following documents must classify correctly:

| Document | Expected Type | Key Signals |
|----------|--------------|-------------|
| OGB Personal Financial Statement | PFS | "Personal Financial Statement" header despite containing "Section 3 – Balance Sheet" |
| OGB Loan Worksheet / Credit Memo | CREDIT_MEMO | "Loan Worksheet" header + DSCR + Recommendation (signals on pages 3–6, requires fullText search) |
| Road Star First Amendment to Lease | COMMERCIAL_LEASE | "Amendment to Lease" + Landlord/Tenant + rent schedule |
| Ellmann & Ellmann P&L (accrual) | INCOME_STATEMENT | Revenue/expenses/net income structure |
| BTR 2024 Ellmann | IRS_BUSINESS | Business tax return signals |
| PTR 2023 Ellmann | IRS_PERSONAL | Personal tax return signals |

Write the AAR confirming which test cases pass before starting Phase 82.
