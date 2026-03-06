# Buddy The Underwriter — Project Roadmap
# Institutional-Grade Commercial Lending AI Platform

**Last Updated: March 2026**
**Status: Active Development**

---

## Vision

Buddy is a commercial lending AI platform that processes financial documents,
performs underwriting analysis, and generates risk assessments for banks.

The north star: **every number that reaches a credit committee must be
correct, traceable, and defensible under audit — without requiring a human
to manually verify the math.**

Buddy is not a tool that assists humans in doing analysis.
Buddy is a system that performs institutional-grade analysis autonomously.
Humans provide credit judgment and final authority. Not data verification.

The difference between Buddy and a spreadsheet is that Buddy handles 100%
of the data work automatically and delivers a verified, ready-to-review spread.
The difference between Buddy and Moody's MMAS is that Buddy proves its own
accuracy mathematically before the spread ever reaches a banker's desk.

**The goal: a banker opens a spread and focuses entirely on credit judgment.
They never wonder if the numbers are right. They already know they are.**

---

## The Accuracy Philosophy — Two Distinct Problems

There is a critical distinction that defines Buddy's architecture:

**Problem 1 — Data accuracy verification.**
Are the extracted numbers correct? Did Buddy get Revenue right? Is COGS right?
This is a TECHNICAL problem. It can be solved with sufficient rigor.
When solved, NO human verification of data is needed.

**Problem 2 — Credit decision authority.**
Should this loan be approved? At what rate? With what structure?
This is a JUDGMENT problem. It requires human authority by regulation.
OCC Model Risk Management (SR 11-7) and FDIC guidance require human oversight
of credit decisions. This is non-negotiable and should not be.

**The target state:** Buddy solves Problem 1 completely and autonomously.
Humans focus entirely on Problem 2. The banker reviews a spread they can
trust completely — not because they checked the math, but because Buddy
proved the math before delivery.

This is better than any existing system. MMAS requires manual data entry
and relies on the analyst to catch errors. Buddy catches errors itself,
proves accuracy mathematically, and delivers a clean spread for credit judgment.

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
Proof-of-Correctness Engine                ← Phase 4 (replaces human gate)
        ↓
Financial Intelligence Layer               ← Phase 5
        ↓
Spread Generation (MMAS format)
        ↓
AUTO-VERIFIED → Banker reviews for credit judgment only
        ↓
Credit Memo + Committee Package
```

### The Omega Architecture

Buddy operates on a dual-layer intelligence model:

- **Buddy** — the domain-specific interface. Processes documents, extracts
  facts, generates spreads, communicates with bankers and borrowers.
  Buddy emits facts. Buddy never forms final credit beliefs.

- **Pulse Omega Prime** — the centralized intelligence core. Receives facts
  from Buddy, applies reasoning and confidence scoring, returns beliefs with
  explicit uncertainty. Omega forms beliefs. Humans make credit decisions.

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

**No incorrect number can reach a spread without being detected and corrected.**

### Four-Gate Proof-of-Correctness System

The system proves accuracy through four independent gates that must ALL pass
before a spread is marked AUTO-VERIFIED. If any gate fails, the system
re-extracts using a different method and tries again. Only after multiple
extraction attempts fail does a document route to human review — and at that
point it is genuinely ambiguous and deserves a human eye.

**Gate 1 — IRS Identity Checks** ← BUILT (Phase 1)
Every accounting identity on the IRS form must reconcile within $1.
Line 1c - Line 2 = Line 3. Total Income - Total Deductions = OBI.
These are mathematical facts. If they hold, the numbers are internally
consistent with the source document. No way to get this wrong and pass.

**Gate 2 — Multi-Source Corroboration** ← Phase 4
The same value must appear in at least two independent locations and agree.
Revenue on Form 1065 page 1 matches Schedule K Total Income.
Depreciation on page 1 matches Form 4562 total.
OBI matches sum of K-1 partner allocations.
When two independent sources agree on the same number, extraction error
probability drops to near zero.

**Gate 3 — Reasonableness Engine** ← Phase 4
Numbers must pass financial sanity checks that catch errors identity checks
cannot see:
- COGS never exceeds revenue (impossible)
- Gross margin within ±3 standard deviations of industry norm for NAICS code
- Year-over-year revenue change within explainable bounds
- Depreciation plausible relative to reported fixed assets
- Interest expense plausible relative to reported debt obligations
- Officer compensation within industry normal range for business size

**Gate 4 — Extraction Confidence Threshold** ← Phase 4
Every extracted value carries a confidence score.
Deterministic line-number match: 0.99
Structural table match: 0.92
AI fallback extraction: 0.75-0.88
All values on a document must exceed 0.90 for AUTO-VERIFIED status.
Values below threshold trigger re-extraction with an alternative method.

**When all four gates pass:**
`spread_verification_status = AUTO-VERIFIED`
No queue. No wait. No human data verification needed.
Spread goes directly to the banker's desk, clean and proven.

**When a gate fails:**
System re-extracts using a different extraction strategy.
Runs all four gates again.
If second extraction also fails: routes to exception queue with full
diagnostic detail — exactly which check failed, by how much, what was
expected. The human reviewer sees a clear problem statement, not raw data.

**Target: 95%+ of clean tax returns hit AUTO-VERIFIED with zero human touch.**

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
Every exception routed to human review makes it smarter — because the system
logs what it got wrong and why, and every pattern informs future extractions.

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

---

### PHASE 2 — Wire Validator Into Extraction Pipeline 🔄 IN PROGRESS

Connect the Phase 1 knowledge base to the live extraction pipeline so that
every document processed by Buddy is automatically validated.

**To Build:**
- `src/lib/extraction/postExtractionValidator.ts`
- Modify `src/lib/extraction/runRecord.ts`
- Modify spread route to return `validationGate` object
- Migration: `deal_document_validation_results` table

---

### PHASE 3 — Formula Accuracy Fixes 📋 QUEUED

Fix three formula errors identified in production on the Samaritus deal.

**Bug 1 — GROSS_PROFIT fails when COGS = 0**
`src/lib/metrics/registry.ts` — remove COST_OF_GOODS_SOLD from requiredFacts,
treat null COGS as zero for service businesses.

**Bug 2 — EBITDA is an identity lookup, not a computation**
`src/lib/metrics/registry.ts` — change EBITDA expr from `"EBITDA"` to
`"ORDINARY_BUSINESS_INCOME + INTEREST_EXPENSE + DEPRECIATION"`

**Bug 3 — OBI in TOTAL_REVENUE alias chain**
`renderStandardSpread.ts` and `v2Adapter.ts` — remove ORDINARY_BUSINESS_INCOME
from TOTAL_REVENUE alias chain. OBI is net income, never top-line revenue.

**Golden fixture tests:**
- Samaritus 2022: Revenue=797989, COGS=0, GP=797989, OBI=325912, EBITDA=526365
- Samaritus 2024: Revenue=1502871, COGS=449671, GP=1053200, OBI=269816

---

### PHASE 4 — Proof-of-Correctness Engine 📋 QUEUED

**This phase replaces the human analyst review gate with autonomous
mathematical proof of accuracy.**

The goal: Buddy proves its own numbers are correct before delivery.
A spread marked AUTO-VERIFIED needs no human data verification.
The banker's job is credit judgment, not checking Buddy's math.

**Component 1: Multi-Source Corroboration Engine**
`src/lib/irsKnowledge/corroborationEngine.ts`

For every key fact, identify secondary sources within the same document set
and verify agreement:

```
Form 1065 corroboration checks:
  GROSS_RECEIPTS: page1_line1c == scheduleK_grossReceipts
  ORDINARY_BUSINESS_INCOME: page1_line22or23 == sum(k1_ordinary_income)
  DEPRECIATION: page1_line16c == form4562_totalDepreciation
  INTEREST: page1_line15 + form1125a_interest == total_interest_expense
  TOTAL_ASSETS: scheduleL_endOfYear == balanceSheet_totalAssets

Form 1120/1120S corroboration:
  GROSS_RECEIPTS: page1 == scheduleM1_bookIncome_bridge
  TOTAL_ASSETS: scheduleL_endOfYear == balanceSheet_totalAssets
  OFFICER_COMP: page1_line12 == form1125e_totalOfficerComp
```

When two independent sources agree within $1: corroboration PASSED.
When they disagree: flag the specific discrepancy with both values.

**Component 2: Reasonableness Engine**
`src/lib/irsKnowledge/reasonablenessEngine.ts`

Financial sanity checks that catch impossible and anomalous values:

```typescript
// Impossible values — hard failures
COGS_EXCEEDS_REVENUE: cogs > grossReceipts → IMPOSSIBLE
NEGATIVE_TOTAL_ASSETS: totalAssets < 0 → IMPOSSIBLE
GROSS_MARGIN_OVER_100: grossProfit > grossReceipts → IMPOSSIBLE
POSITIVE_INCOME_WITH_REVENUE_ZERO: obi > 0 && grossReceipts === 0 → IMPOSSIBLE

// Anomalous values — soft warnings, include in confidence scoring
GROSS_MARGIN_OUTSIDE_INDUSTRY_NORM: |margin - industryNorm| > 2σ
REVENUE_CHANGE_EXTREME: |yoyChange| > 50% without explanation
DEPRECIATION_IMPLAUSIBLE: depreciation > fixedAssetsGross * 0.5
OFFICER_COMP_EXTREME: officerComp > revenue * 0.5 or < revenue * 0.02
INTEREST_IMPLAUSIBLE: interestExpense > totalDebt * 0.20
```

Industry norms sourced from Phase 6 NAICS industry profiles.
For Phase 4, use broad defaults until industry profiles are built.

**Component 3: Confidence Aggregator**
`src/lib/irsKnowledge/confidenceAggregator.ts`

Aggregate per-field confidence scores into a document-level score:

```
document_confidence =
  weighted_average(field_confidence_scores)
  × identity_check_multiplier    (1.0 if all pass, 0.7 if any fail)
  × corroboration_multiplier     (1.0 if all pass, 0.8 if partial, 0.5 if fail)
  × reasonableness_multiplier    (1.0 if all pass, 0.9 if soft warnings only)

AUTO_VERIFIED threshold: document_confidence >= 0.92
FLAGGED threshold:       document_confidence >= 0.75
BLOCKED threshold:       document_confidence < 0.75
```

**Component 4: Intelligent Re-Extraction**
`src/lib/extraction/reExtractionOrchestrator.ts`

When any gate fails on first extraction, automatically re-extract using
a different strategy before routing to human review:

```
Attempt 1: Deterministic line-number matching (fast, precise)
  → If identity checks fail → Attempt 2

Attempt 2: Structural table extraction (layout-aware)
  → If identity checks fail → Attempt 3

Attempt 3: AI-guided extraction with explicit form knowledge
  (Prompt includes form spec, known line numbers, identity checks to satisfy)
  → If identity checks still fail → Route to exception queue

Exception queue entry includes:
  - Which specific checks failed
  - By exactly how much
  - What values were found vs what was expected
  - All three extraction attempts side by side
```

**Component 5: AUTO-VERIFIED Status + Audit Certificate**

When all four gates pass after any extraction attempt:
- Set `verification_status = AUTO_VERIFIED`
- Set `verification_method = "proof_of_correctness"`
- Generate verification certificate stored in ledger:

```json
{
  "document_id": "...",
  "verification_status": "AUTO_VERIFIED",
  "gates_passed": {
    "irs_identity_checks": { "passed": 3, "failed": 0 },
    "multi_source_corroboration": { "passed": 4, "failed": 0 },
    "reasonableness_checks": { "passed": 8, "failed": 0 },
    "confidence_threshold": { "score": 0.97, "threshold": 0.92 }
  },
  "verified_at": "2026-03-06T...",
  "extraction_attempt": 1,
  "auditable": true
}
```

This certificate is the audit trail. It proves, deterministically, that
Buddy verified its own output before delivery. An OCC examiner can look
at this certificate and see exactly what was checked and how.

**Human review queue — for genuine exceptions only:**
Documents that fail all three extraction attempts route to a queue.
These will be rare. When they occur, the banker sees exactly what failed
and why — not a generic "please review" message.
After review, the correction feeds back into the extraction improvement loop.

---

### PHASE 5 — Financial Intelligence Layer 📋 QUEUED

Build the credit intelligence that transforms raw extracted numbers into
analyst-quality adjusted financials.

**EBITDA Add-Back Engine**
- Standard add-backs: D&A, interest, Section 179, bonus depreciation
- Industry add-backs: guaranteed payments (partnerships), officer comp
  normalization, non-recurring items
- Interest-in-COGS detection: maritime, construction, and other industries
  where interest is classified as a direct cost

**Officer Compensation Normalization**
- Flag when officer comp is >40% or <10% of revenue
- Compute adjusted EBITDA with market-rate officer comp assumption
- Document the adjustment with source and methodology

**Global Cash Flow Builder**
- Multi-entity picture: operating company + personal guarantors
- K-1 income mapped to correct personal return
- Ownership percentage applied to entity income
- Personal debt obligations from personal returns included

**Schedule M-1 Exploitation**
- Book-to-tax bridge reveals non-cash and non-deductible items
- Use M-1 data to improve EBITDA reconstruction accuracy
- Flag significant book-tax differences for credit analysis

---

### PHASE 6 — Industry Intelligence 📋 QUEUED

NAICS-based industry profiles that make every extraction and analysis
industry-aware. Feeds directly into Phase 4 Reasonableness Engine.

**Initial profiles:**
- Maritime / Charter Boats (NAICS 487210) — interest in COGS, heavy depr
- Real Estate (NAICS 531) — NOI-based analysis, depreciation add-back
- Medical Practices (NAICS 621) — personal goodwill, equipment depreciation
- Construction (NAICS 236-238) — WIP, equipment, bonding
- Retail (NAICS 44-45) — inventory method, COGS structure
- Restaurants (NAICS 722) — food cost ratios, labor percentages
- Professional Services (NAICS 541) — low COGS, high labor, DSO analysis

Each profile includes: normal gross margin range, typical COGS components,
where interest expense typically lives, officer comp norms, red flags.

---

### PHASE 7 — Cross-Document Reconciliation 📋 QUEUED

Reconcile numbers across multiple documents in a deal package.

**Checks:**
```
K-1 to Entity:    sum(k1_income × ownership_pct) ≈ entity_obi
K-1 to Personal:  k1_on_personal ≈ k1_on_entity × ownership_pct
Tax to Financials: tax_revenue ≈ statement_revenue (within 5%)
Balance Sheet:    assets = liabilities + equity (both sources)
Multi-year trend: revenue/margin changes within explainable bounds
```

---

### PHASE 8 — Golden Corpus + Continuous Learning 📋 QUEUED

**Golden Corpus**
Library of verified documents with ground-truth values.
Every type, every industry, multiple years.
Automated CI tests assert extraction matches ground truth on every commit.

Minimum corpus:
- 5 Form 1065 (different industries, different years)
- 3 Form 1120 / 3 Form 1120S
- 3 Form 1040 with Schedule C
- 2 audited / 2 reviewed financial statements
- 1 complex multi-entity deal with K-1s flowing to personal returns

**Continuous Learning Loop**
Every exception routed to human review:
1. Logs original extraction, correct values, and what failed
2. Nightly analysis: which fields, which document types, which industries
   produce the most exceptions
3. High-frequency exception patterns flag extraction rules for improvement
4. Over time: exception rate drops as rules improve
5. Target: <2% exception rate on standard tax returns within 12 months

---

### PHASE 9 — Full Commercial Banking Relationship 📋 FUTURE

Expand beyond loans to full relationship banking.

**Three Pillars:**
- Loans — credit analysis, underwriting (current focus)
- Deposits — operating account analysis, relationship pricing
- Treasury — cash management, rate products, FX, hedging

**Relationship Pricing:**
Model full relationship value in credit and pricing decisions.
Legal compliant bundling (not tying) of treasury and deposit value.

**Crypto Lending:**
Real-time collateral monitoring via trigger price indexing.
Margin call automation. Digital asset custody integration.

---

## Technical Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js, Tailwind, Vercel |
| Database | Supabase (PostgreSQL) |
| AI Models | Claude (Anthropic), Gemini Flash (extraction) |
| Integration | MCP (Model Context Protocol) |
| Event Ledger | Supabase `deal_events` (append-only) |
| Deployment | Vercel (frontend), Cloud Run (workers) |
| Observability | Aegis findings, Sentry |
| Testing | Vitest, Playwright |

---

## Current Active Deals / Test Cases

**Samaritus Management LLC** (EIN 86-2437722)
Charter boat business, Florida
Deal ID: 04312437-2bf3-4f72-b1eb-464a2b1bedc5

Ground truth (manually verified):
- 2022: Revenue 797,989 | COGS 0 | GP 797,989 | OBI 325,912 | Depr 191,385
- 2024: Revenue 1,502,871 | COGS 449,671 | GP 1,053,200 | OBI 269,816 | Depr 287,050

Use this deal to verify all Phase 3 formula fixes and Phase 4 gate logic.

---

## Definition of Done — God Tier

Buddy reaches god tier when ALL of the following are true:

1. **AUTO-VERIFIED on 95%+ of clean tax returns** — no human data verification
2. **IRS identity checks pass** on every extracted document
3. **Multi-source corroboration** confirms key facts from independent sources
4. **Reasonableness engine** catches impossible and anomalous values
5. **Formula accuracy** — every computed spread line is mathematically verifiable
6. **Full provenance** — every number traces to document, page, line, method
7. **Golden corpus tests** pass on every commit, every document type
8. **Continuous learning** — exception rate drops measurably each quarter
9. **Audit certificate** generated for every AUTO-VERIFIED spread
10. **Banker experience** — opens a spread, trusts the numbers, focuses on credit

When all ten are true, Buddy is the most accurate financial spreading system
in commercial lending. Better than MMAS. Better than any competitor.
Not because it's smarter — because it proves itself right before delivery.

---

## Build Principles

- No inline math in templates. All formulas route through evaluateMetric().
- No duplicate formulas. Metric registry is the single source of truth.
- Facts are the single data interchange format. Never bypass the fact layer.
- Migrations are additive only. Never DROP or alter existing columns.
- RLS on every table. No exceptions.
- Snapshot immutability. deal_model_snapshots is INSERT-only. Audit trail.
- Validation errors are never fatal. They log, they flag, they never block.
- Proof beats trust. Never trust extracted data — prove it or re-extract.

---

*This document is the project's north star. Every PR advances at least one
phase. Every phase makes Buddy more accurate, more autonomous, and more
valuable. The mission is a system that a banker can trust completely —
not because they verified it, but because it verified itself.*
