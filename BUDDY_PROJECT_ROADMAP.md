# Buddy The Underwriter — Project Roadmap
# Institutional-Grade Commercial Lending AI Platform

**Last Updated: March 2026**
**Status: Active Development**

---

## Vision

Buddy is a commercial lending AI platform that processes financial documents,
performs underwriting analysis, and generates risk assessments for banks.

The north star is simple: **every number that reaches a credit committee must
be correct, traceable, and defensible under audit.**

Buddy is not a tool that assists humans in doing analysis.
Buddy is a system that performs institutional-grade analysis autonomously,
with humans providing governance, oversight, and final credit authority.

The difference between Buddy and a spreadsheet is that Buddy handles 90% of
the work automatically and only surfaces the hard cases for human judgment.
The difference between Buddy and legacy systems like Moody's MMAS is that
Buddy learns, improves, and doesn't require 100% manual data entry.

---

## Core Architecture

### The Intelligence Stack

```
Documents (tax returns, financials, statements)
        ↓
Document Classification + OCR
        ↓
Structured Extraction Engine
        ↓
IRS Knowledge Base + Identity Validation    ← Phase 1 & 2 COMPLETE
        ↓
Financial Intelligence Layer               ← Phase 3
        ↓
Spread Generation (MMAS format)
        ↓
Analyst Review Gate
        ↓
Credit Memo + Committee Package
```

### The Omega Architecture

Buddy operates on a dual-layer intelligence model:

- **Buddy** — the domain-specific interface. Processes documents, extracts
  facts, generates spreads, communicates with bankers and borrowers.
  Buddy emits facts. Buddy never forms final beliefs.

- **Pulse Omega Prime** — the centralized intelligence core. Receives facts
  from Buddy, applies reasoning and confidence scoring, returns beliefs with
  explicit uncertainty. Omega forms beliefs. Humans make decisions.

This separation is regulatory by design. AI explains. Rules decide.
Humans retain final credit authority through credit committee governance.

### Six Kernel Primitives

Every piece of data in the system maps to one of:

1. **Entity** — what exists (borrower, guarantor, deal, document)
2. **State** — what Omega believes is true (with confidence score)
3. **Event** — immutable record of what happened (append-only ledger)
4. **Constraint** — governing rules (bank policy, regulatory requirements)
5. **Confidence** — certainty levels that gate autonomous action
6. **Trace** — decision explanations (full audit trail)

---

## The Accuracy Imperative

**Commercial lending operates on a zero-error standard.**

An incorrect number in a spread is not a UX bug. It is a credit decision made
on false information. It exposes the bank to regulatory risk, loan losses, and
audit failures. It destroys trust with the bankers who depend on the system.

Therefore Buddy's accuracy architecture is non-negotiable:

**No incorrect number can reach a spread without being detected.**

### Three-Tier Accuracy System

**Tier 1 — AI Extraction**
Probabilistic. Fast. Handles 80-90% of cases correctly automatically.
Outputs confidence scores. Flags uncertainty explicitly.

**Tier 2 — IRS Identity Validation** ← BUILT
Deterministic. After extraction, verify every number against the accounting
identities built into the IRS form. These are mathematical facts that must hold.
If extracted numbers don't satisfy them, extraction failed.

**Tier 3 — Analyst Review Gate** ← IN PROGRESS
Any document that fails identity checks, or where confidence falls below
threshold, goes into a human review queue. A human verifies and signs off
before the spread is marked distribution-ready.

Together these three tiers produce audit-grade output. No tier alone is
sufficient. All three working together is the accuracy guarantee.

---

## Domain Knowledge Requirement

Buddy must be an institutional-grade expert in:

- **IRS Forms** — every form, every line, every schedule, versioned by tax year
- **GAAP** — revenue recognition, depreciation methods, inventory methods
- **Tax Basis Accounting** — cash vs accrual, Section 179, bonus depreciation
- **Commercial Credit** — DSCR, global cash flow, EBITDA reconstruction,
  debt yield, stressed coverage ratios, guarantor analysis
- **Industry Adjustments** — add-backs specific to maritime, real estate,
  medical practices, construction, retail, and every major industry
- **Document Trust Hierarchy** — audited > reviewed > compiled > tax return >
  bank statements. When the same value appears in multiple documents,
  the highest-trust source wins.

This knowledge is not a prompt. It is a living, versioned, tested codebase
that encodes the expertise of seasoned credit officers and CPAs.
Every correction from an analyst makes it smarter.

---

## Roadmap

---

### PHASE 1 — IRS Knowledge Base Foundation ✅ COMPLETE
**PR #169 — Merged**

Built the domain intelligence foundation that everything else runs on.

**Delivered:**
- `src/lib/irsKnowledge/types.ts` — 57 canonical fact keys, 20 IRS form types,
  document trust hierarchy, validation result types
- `src/lib/irsKnowledge/formSpecs/form1065.ts` — Partnership returns 2021-2024,
  handles OBI line number change (Line 22 → Line 23 between 2022 and 2024)
- `src/lib/irsKnowledge/formSpecs/form1120.ts` — C-Corp and S-Corp returns
- `src/lib/irsKnowledge/formSpecs/scheduleC.ts` — Sole proprietor returns
- `src/lib/irsKnowledge/identityValidator.ts` — IRS identity check engine,
  returns VERIFIED / FLAGGED / BLOCKED / PARTIAL with full audit trail
- `src/lib/irsKnowledge/index.ts` — Barrel export + form spec router
- 5 tests, all passing. Test 3 catches the OBI-as-revenue extraction bug
  found in production on the Samaritus Management deal.

**Key design decisions:**
- COGS null-as-zero: service businesses have no COGS, null is valid
- Graduated response: not binary block/allow but VERIFIED/FLAGGED/BLOCKED/PARTIAL
- Versioned by tax year: line numbers change between years (this has already
  caused production extraction errors)

---

### PHASE 2 — Wire Validator Into Extraction Pipeline 🔄 IN PROGRESS

Connect the Phase 1 knowledge base to the live extraction pipeline so that
every document processed by Buddy is automatically validated.

**To Build:**
- `src/lib/extraction/postExtractionValidator.ts` — bridge between extraction
  and IRS knowledge base. Fires after every successful extraction run.
  Loads facts from DB, runs validation, persists results, writes Aegis findings.
- Modify `src/lib/extraction/runRecord.ts` — fire postExtractionValidation
  after finalizeExtractionRun with status=succeeded (dynamic import,
  fire-and-forget, never blocks extraction)
- Modify `src/app/api/deals/[dealId]/spreads/standard/route.ts` — add
  validationGate object to every spread response
- Migration: `deal_document_validation_results` table

**After Phase 2:**
Every extraction automatically runs IRS checks. Blocked extractions surface
in Aegis. Bankers see validation status on every spread.

---

### PHASE 3 — Formula Accuracy Fixes 📋 QUEUED

Fix the three formula errors identified in the spread calculation audit.
These are blocking correct spread rendering for real deals.

**Bugs to fix:**

**Bug 1 — GROSS_PROFIT fails when COGS = 0**
Location: `src/lib/metrics/registry.ts`
Problem: `GROSS_PROFIT.requiredFacts` includes `COST_OF_GOODS_SOLD`. When COGS
is absent (service business), evaluateMetric returns null instead of Revenue.
Fix: Remove COST_OF_GOODS_SOLD from requiredFacts. When COGS is null,
treat as 0. Gross Profit = Revenue for service companies.

**Bug 2 — EBITDA is an identity lookup, not a computation**
Location: `src/lib/metrics/registry.ts`
Problem: EBITDA expr is `"EBITDA"` — just looks up a pre-computed fact.
If the fact was computed from wrong inputs, the error propagates silently.
Fix: Change expr to `"ORDINARY_BUSINESS_INCOME + INTEREST_EXPENSE + DEPRECIATION"`
so EBITDA is always computed from components, never trusted as a stored value.

**Bug 3 — OBI in TOTAL_REVENUE alias chain**
Location: `src/lib/financialSpreads/standard/renderStandardSpread.ts`
and `src/lib/financialSpreads/standard/v2Adapter.ts`
Problem: TOTAL_REVENUE alias chain includes ORDINARY_BUSINESS_INCOME as a
fallback. OBI is net income (after all deductions), never top-line revenue.
When revenue is missing, OBI fills in — producing catastrophically wrong spreads.
Fix: Remove ORDINARY_BUSINESS_INCOME from TOTAL_REVENUE alias chain entirely.
OBI belongs only in NET_PROFIT aliases.

**Golden fixture tests to add:**
After fixes, add test assertions:
- Samaritus 2022: Revenue=797989, COGS=0, GP=797989, OBI=325912, EBITDA=526365
- Samaritus 2024: Revenue=1502871, COGS=449671, GP=1053200, OBI=269816

---

### PHASE 4 — Analyst Review Gate UI 📋 QUEUED

Surface validation status to bankers in the spread UI.

**To Build:**
- Spread header banner: VERIFIED (green) / FLAGGED (yellow) / BLOCKED (red)
- Per-column validation indicators on spread cells sourced from flagged documents
- "Mark as Reviewed" button for analysts to sign off on flagged documents
- Spread export (PDF) blocked until all documents are VERIFIED or ANALYST_VERIFIED
- `analyst_verified_at`, `analyst_verified_by` columns on deal_document_validation_results
- `is_distribution_ready` flag on deal_spreads — only true after analyst sign-off

**Design principle:**
A spread with BLOCKED status still renders — but with a prominent red banner
and no export capability. The banker can see the data and investigate.
They cannot send it to a credit committee. This is the accuracy guarantee.

---

### PHASE 5 — Financial Intelligence Layer 📋 QUEUED

Build the credit intelligence that transforms raw extracted numbers into
analyst-quality adjusted financials.

**Components:**

**EBITDA Add-Back Engine**
- Standard add-backs: D&A, interest, Section 179, bonus depreciation
- Industry add-backs: guaranteed payments (partnerships), officer comp
  normalization (closely-held corps), non-recurring items
- Interest-in-COGS detection: for maritime, construction, and other industries
  where interest is classified as a direct cost, identify and pull it out
  for the EBITDA add-back regardless of where it appears on the return

**Officer Compensation Normalization**
- Closely-held businesses often pay officers above or below market rate
- Above market: excess compensation is an effective add-back (real EBITDA higher)
- Below market: owner taking distributions instead — personal cash flow higher
  than the return shows, but entity cash flow may be overstated
- System flags when officer comp is >40% or <10% of revenue for analyst review

**Global Cash Flow Builder**
- Assembles the complete borrower picture across:
  - Entity tax returns (operating income)
  - Personal tax returns (W-2, other Schedule C, K-1 income)
  - Guarantor returns (for personal guarantee analysis)
- Maps K-1 income to the correct personal return
- Applies ownership percentage to entity income for global cash flow

**Schedule M-1 Exploitation**
- M-1 reconciles book income to tax income
- Contains: depreciation timing differences, meals & entertainment,
  officer life insurance, other book-tax differences
- Using M-1 makes EBITDA reconstruction significantly more accurate
- System must pull M-1 data when available and use it for add-back analysis

---

### PHASE 6 — Industry Intelligence 📋 QUEUED

Build industry-aware extraction and analysis profiles.

**NAICS-Based Industry Profiles**
When a deal is classified to a NAICS code, load the corresponding industry
profile that tells the system:
- What COGS typically includes for this industry
- Where interest expense typically lives (line 15 vs inside COGS)
- What depreciation add-backs are typical
- What officer compensation norms look like
- What gross margin ranges are normal vs anomalous
- Industry-specific red flags

**Initial Industry Profiles to Build:**
- Maritime / Charter Boats (NAICS 487210) — interest in COGS, heavy depreciation
- Real Estate (NAICS 531) — NOI-based analysis, depreciation add-back
- Medical Practices (NAICS 621) — personal goodwill, equipment depreciation
- Construction (NAICS 236-238) — WIP accounting, equipment, bonding
- Retail (NAICS 44-45) — inventory method, COGS structure
- Restaurants (NAICS 722) — food cost ratios, labor percentages
- Professional Services (NAICS 541) — low COGS, high labor, DSO analysis

---

### PHASE 7 — Cross-Document Reconciliation 📋 QUEUED

Reconcile numbers across multiple documents to catch inconsistencies that
single-document validation cannot detect.

**Reconciliation Checks:**

K-1 to Entity Return:
```
sum(k1_ordinary_income × ownership_pct) ≈ entity_ordinary_business_income
```

K-1 to Personal Return:
```
k1_income_on_personal_return ≈ k1_income_on_entity_return × ownership_pct
```

Tax Return to Financial Statement:
```
tax_return_gross_receipts ≈ income_statement_revenue (within 5%)
tax_return_total_assets ≈ balance_sheet_total_assets (within 5%)
```

Multi-Year Trend Reasonableness:
```
revenue_growth_yoy within industry norms
gross_margin_change within ±10% year-over-year
depreciation_as_pct_of_fixed_assets within expected range
```

---

### PHASE 8 — Golden Corpus + Continuous Learning 📋 QUEUED

Build the test corpus and feedback loop that makes Buddy smarter over time.

**Golden Corpus**
A library of verified financial documents with ground-truth extraction values.
Every document type, every major industry, multiple tax years.
Automated tests assert that extraction matches ground truth on every commit.
No regression may be introduced without failing tests.

Minimum corpus at launch:
- 5 Form 1065 returns (different industries, different years)
- 3 Form 1120 returns
- 3 Form 1120S returns
- 3 Form 1040 returns with Schedule C
- 2 audited financial statements
- 2 reviewed financial statements
- 1 complex multi-entity deal with K-1s flowing to personal returns

**Analyst Correction Loop**
When an analyst corrects an extracted value:
1. Write correction to `deal_financial_facts` with source_type = MANUAL
2. Write correction event to ledger
3. Write to `extraction_correction_log` with original vs corrected value,
   document type, tax year, field, and analyst ID
4. Nightly job computes correction frequency by field × document type
5. High-frequency corrections flag the extraction rule for review
6. Over time: corrections become training signal for improved extraction prompts

---

### PHASE 9 — Full Commercial Banking Relationship 📋 FUTURE

Expand Buddy from loan-only to full commercial banking relationship.

Commercial officers work across three pillars:
- **Loans** — credit analysis, underwriting, risk assessment (current focus)
- **Deposits** — operating account analysis, deposit relationship pricing
- **Treasury** — cash management, interest rate products, FX, hedging

Relationship Pricing:
- Legally bundle treasury and deposit considerations into loan pricing
- Move beyond illegal tying arrangements toward compliant relationship pricing
- Model the full relationship value when making credit and pricing decisions

Crypto Lending:
- Real-time monitoring of crypto collateral values
- Trigger price indexing for margin calls (computationally efficient —
  not continuous polling)
- Integration with digital asset custody platforms

---

## Technical Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js, Tailwind, Vercel |
| Database | Supabase (PostgreSQL) |
| AI Models | Claude (Anthropic), Gemini Flash (extraction) |
| Integration | MCP (Model Context Protocol) |
| Event Ledger | Supabase `deal_events` table (append-only) |
| Deployment | Vercel (frontend), Cloud Run (workers) |
| Observability | Aegis findings system, Sentry |
| Testing | Vitest, Playwright |

---

## Current Active Deals / Test Cases

**Samaritus Management LLC** (EIN 86-2437722)
- Charter boat business, Florida
- Deal ID: 04312437-2bf3-4f72-b1eb-464a2b1bedc5
- Documents: 2022 Form 1065, 2024 Form 1065
- Ground truth verified manually:
  - 2022: Revenue 797,989 | COGS 0 | GP 797,989 | OBI 325,912 | Depr 191,385
  - 2024: Revenue 1,502,871 | COGS 449,671 | GP 1,053,200 | OBI 269,816 | Depr 287,050
- Known extraction bugs caught by Phase 1 tests (Bugs 1, 2, 3 above)
- Use this deal to verify all Phase 3 formula fixes

---

## Definition of Done — Institutional Grade

Buddy reaches institutional-grade when ALL of the following are true:

1. **IRS identity checks pass** on every extracted document before spreads render
2. **Formula accuracy**: every computed line in every spread is mathematically
   verifiable against source facts
3. **Full provenance**: every number in every spread traces to a specific
   document, page, line number, and extraction method
4. **Analyst sign-off gate**: no spread reaches distribution without a human
   reviewing and confirming accuracy
5. **Golden corpus tests**: automated tests covering every major document type
   pass on every commit
6. **Correction loop**: analyst corrections feed back into extraction quality
   metrics and flag high-frequency error patterns for remediation
7. **Audit trail**: every fact, every computation, every decision is recorded
   in the immutable event ledger with timestamps and actor IDs

When all seven are true, Buddy produces spreads that can withstand OCC, FDIC,
and internal audit scrutiny. That is the standard. That is the goal.

---

## Build Principles

From `BUDDY_BUILD_RULES.md` — enforced on every PR:

- No inline math in templates. All formulas route through evaluateMetric().
- No duplicate formulas. Metric registry is the single source of truth.
- Facts are the single data interchange format. Never bypass the fact layer.
- Migrations are additive only. Never DROP or alter existing columns.
- RLS on every table. No exceptions.
- Snapshot immutability. deal_model_snapshots is INSERT-only. Audit trail.
- Validation errors are never fatal. They log, they flag, they never block.

---

*This document is the project's north star. Every PR should advance at least
one phase. Every phase that completes makes Buddy more accurate, more
auditable, and more valuable to the banks that depend on it.*
