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

**Problem 1 — Data accuracy verification.**
Are the extracted numbers correct? This is a TECHNICAL problem.
It can be solved with sufficient rigor. When solved, NO human verification needed.

**Problem 2 — Credit decision authority.**
Should this loan be approved? At what rate? With what structure?
This is a JUDGMENT problem. OCC SR 11-7 and FDIC guidance require human
oversight of credit decisions. Non-negotiable and should not be.

**The target state:** Buddy solves Problem 1 completely and autonomously.
Humans focus entirely on Problem 2.

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
IRS Knowledge Base + Identity Validation    ✅ Phase 1 & 2 COMPLETE
        ↓
Formula Accuracy Layer                      ✅ Phase 3 COMPLETE
        ↓
Proof-of-Correctness Engine                🔄 Phase 4 IN PROGRESS
        ↓
Financial Intelligence Layer               📋 Phase 5
        ↓
Spread Generation (MMAS format)
        ↓
AUTO-VERIFIED → Banker reviews for credit judgment only
        ↓
Credit Memo + Committee Package
```

### The Omega Architecture

- **Buddy** — domain-specific interface. Extracts facts, generates spreads.
  Buddy emits facts. Never forms final credit beliefs.
- **Pulse Omega Prime** — centralized intelligence core. Applies reasoning
  and confidence scoring. Omega forms beliefs. Humans make credit decisions.

AI explains. Rules decide. Humans retain final credit authority.

### Six Kernel Primitives

1. **Entity** — what exists
2. **State** — what Omega believes is true (with confidence score)
3. **Event** — immutable record of what happened (append-only ledger)
4. **Constraint** — governing rules
5. **Confidence** — certainty levels that gate autonomous action
6. **Trace** — decision explanations (full audit trail)

---

## The Four-Gate Proof-of-Correctness System

The system proves accuracy through four independent gates that must ALL pass
before a spread is marked AUTO-VERIFIED. If any gate fails, the system
re-extracts automatically. Only genuine failures after three attempts route
to human review — with a precise diagnostic, not a vague flag.

**Gate 1 — IRS Identity Checks** ✅ BUILT (Phase 1)
Mathematical proof that extracted numbers are internally consistent.
Line 1c - Line 2 = Line 3. Total Income - Deductions = OBI. Tolerance: $1.

**Gate 2 — Multi-Source Corroboration** 🔄 Phase 4
Same value confirmed from two independent sources.
Revenue page 1 == Schedule K. Depreciation page 1 == Form 4562.
OBI == sum of K-1 allocations. Two sources agree → error probability near zero.

**Gate 3 — Reasonableness Engine** 🔄 Phase 4
Financial sanity checks. COGS never exceeds revenue. Gross margin within
industry norms. Depreciation plausible relative to fixed assets.
Catches errors that pass identity checks but are still obviously wrong.

**Gate 4 — Confidence Threshold** 🔄 Phase 4
All extracted values must score ≥ 0.90. Deterministic match = 0.99.
AI fallback = 0.75-0.88. Below threshold → re-extract with different method.

**When all four pass:** `AUTO-VERIFIED`. No queue. No wait.
**Target: 95%+ of clean tax returns AUTO-VERIFIED with zero human touch.**

---

## Roadmap

---

### PHASE 1 — IRS Knowledge Base Foundation ✅ COMPLETE
**PR #169 — Merged**

- `src/lib/irsKnowledge/types.ts` — 57 canonical fact keys, 20 IRS form types
- `src/lib/irsKnowledge/formSpecs/form1065.ts` — 2021-2024, OBI line shift handled
- `src/lib/irsKnowledge/formSpecs/form1120.ts` — C-Corp and S-Corp
- `src/lib/irsKnowledge/formSpecs/scheduleC.ts` — Sole proprietor
- `src/lib/irsKnowledge/identityValidator.ts` — VERIFIED/FLAGGED/BLOCKED/PARTIAL
- 5/5 tests passing. Test 3 catches the OBI-as-revenue production bug.

---

### PHASE 2 — Wire Validator Into Extraction Pipeline ✅ COMPLETE
**PR #170 — Merged (commit 508f24f1)**

- `src/lib/extraction/postExtractionValidator.ts` — runs after every extraction,
  validates facts against IRS identity checks, writes Aegis findings on failure
- `src/lib/extraction/runRecord.ts` — dynamic import hook, fire-and-forget,
  never blocks extraction finalization
- Spread route returns `validationGate` object on every response
- Migration: `deal_document_validation_results` table with RLS

---

### PHASE 3 — Formula Accuracy Fixes ✅ COMPLETE
**PR #171 — Merged**

Fixed three production bugs causing wrong numbers on real deals.

- **Bug 1 FIXED:** GROSS_PROFIT `requiredFacts` → `["TOTAL_REVENUE"]` only.
  Null COGS treated as 0. Service businesses now compute correctly.
- **Bug 2 FIXED:** EBITDA expr → `"ORDINARY_BUSINESS_INCOME + INTEREST_EXPENSE
  + DEPRECIATION"`. Computed from components, never looked up as stored value.
- **Bug 3 FIXED:** OBI removed from TOTAL_REVENUE alias chain. `NULL_AS_ZERO_KEYS`
  pre-processing added to both renderers.
- 6/6 golden fixture tests pass. 49/49 existing tests pass. tsc clean.

**Samaritus verified:**
- 2022: Revenue 797,989 | COGS 0 | GP 797,989 | OBI 325,912 | EBITDA 526,365 ✓
- 2024: Revenue 1,502,871 | COGS 449,671 | GP 1,053,200 | OBI 269,816 ✓

---

### PHASE 4 — Proof-of-Correctness Engine 🔄 NEXT

**Objective:** Buddy proves its own accuracy before delivery.
A spread marked AUTO-VERIFIED requires zero human data verification.
The banker's job is credit judgment. Not checking Buddy's math.

**Component 1: Multi-Source Corroboration Engine**
`src/lib/irsKnowledge/corroborationEngine.ts`

Cross-check key facts against secondary sources in the same document set:

```
Form 1065:
  GROSS_RECEIPTS:            page1_line1c == scheduleK_grossReceipts
  ORDINARY_BUSINESS_INCOME:  page1_obi == sum(k1_ordinary_income_all_partners)
  DEPRECIATION:              page1_line16c == form4562_totalDepreciation
  INTEREST:                  page1_line15 + form1125a_interest == total_interest
  TOTAL_ASSETS:              scheduleL_endOfYear == reported_total_assets

Form 1120/1120S:
  TOTAL_ASSETS:   scheduleL_endOfYear == balance_sheet_total_assets
  OFFICER_COMP:   page1_line12 == form1125e_total_officer_comp
```

Agreement within $1 = corroboration PASSED.
Disagreement = flag with both values and source locations.

**Component 2: Reasonableness Engine**
`src/lib/irsKnowledge/reasonablenessEngine.ts`

```typescript
// Hard failures — mathematically impossible
COGS_EXCEEDS_REVENUE:              cogs > grossReceipts
NEGATIVE_TOTAL_ASSETS:             totalAssets < 0
GROSS_MARGIN_OVER_100PCT:          grossProfit > grossReceipts
INCOME_WITHOUT_REVENUE:            obi > 0 && grossReceipts === 0

// Soft warnings — anomalous, score penalty applied
GROSS_MARGIN_OUTSIDE_INDUSTRY:     |margin - industryNorm| > 2 std devs
REVENUE_CHANGE_EXTREME:            |yoyChange| > 50%
DEPRECIATION_IMPLAUSIBLE:          depreciation > fixedAssetsGross * 0.5
OFFICER_COMP_EXTREME:              officerComp > revenue * 0.5
INTEREST_IMPLAUSIBLE:              interestExpense > reportedDebt * 0.20
```

Use broad default norms for Phase 4. Phase 6 will add NAICS-specific norms.

**Component 3: Confidence Aggregator**
`src/lib/irsKnowledge/confidenceAggregator.ts`

```
document_confidence =
  weighted_average(per_field_confidence_scores)
  × identity_check_multiplier    (1.0 all pass | 0.7 any fail)
  × corroboration_multiplier     (1.0 all pass | 0.8 partial | 0.5 fail)
  × reasonableness_multiplier    (1.0 all pass | 0.9 soft warnings only)

AUTO_VERIFIED:  score >= 0.92
FLAGGED:        score >= 0.75
BLOCKED:        score < 0.75
```

**Component 4: Intelligent Re-Extraction**
`src/lib/extraction/reExtractionOrchestrator.ts`

```
Attempt 1: Deterministic line-number matching
  → Gates fail → Attempt 2

Attempt 2: Structural table extraction (layout-aware)
  → Gates fail → Attempt 3

Attempt 3: AI-guided extraction with full form spec in prompt
  (includes line numbers, identity checks, known label variants)
  → Gates fail → Route to exception queue

Exception queue entry: which checks failed, by how much,
all three attempts side by side. Precise, actionable, not vague.
```

**Component 5: AUTO-VERIFIED Audit Certificate**

When all four gates pass, generate and store:
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
  "verified_at": "ISO_TIMESTAMP",
  "extraction_attempt": 1,
  "auditable": true
}
```

OCC examiner can review this certificate and see exactly what was proved.

---

### PHASE 5 — Financial Intelligence Layer 📋 QUEUED

Transform raw extracted numbers into analyst-quality adjusted financials.

**EBITDA Add-Back Engine**
- Standard: D&A, interest, Section 179, bonus depreciation
- Partnership: guaranteed payments (equivalent to officer comp)
- Industry: interest-in-COGS detection for maritime, construction
- Non-recurring: one-time expenses and income identified and flagged

**Officer Compensation Normalization**
- Flag when officer comp >40% or <10% of revenue
- Compute adjusted EBITDA with market-rate assumption
- Document adjustment with source and methodology for audit trail

**Global Cash Flow Builder**
- Entity operating income + personal guarantor income
- K-1 allocations mapped to correct personal returns
- Ownership percentage applied correctly
- Personal debt obligations factored in

**Schedule M-1 Exploitation**
- Book-to-tax bridge reveals non-cash and non-deductible items
- Significant book-tax differences flagged for credit analysis
- Improves EBITDA reconstruction accuracy meaningfully

---

### PHASE 6 — Industry Intelligence 📋 QUEUED

NAICS-based profiles that make extraction and analysis industry-aware.
Feeds into Phase 4 Reasonableness Engine for calibrated norms.

**Initial profiles:**
- Maritime / Charter Boats (NAICS 487210)
- Real Estate (NAICS 531)
- Medical Practices (NAICS 621)
- Construction (NAICS 236-238)
- Retail (NAICS 44-45)
- Restaurants (NAICS 722)
- Professional Services (NAICS 541)

Each profile: gross margin norms, COGS components, interest location,
officer comp norms, depreciation expectations, industry red flags.

---

### PHASE 7 — Cross-Document Reconciliation 📋 QUEUED

Reconcile numbers across all documents in a deal package.

```
K-1 → Entity:      sum(k1 × ownership_pct) ≈ entity_obi
K-1 → Personal:    k1_on_personal ≈ k1_on_entity × ownership_pct
Tax → Financials:  tax_revenue ≈ statement_revenue (within 5%)
Balance Sheet:     assets = liabilities + equity (confirmed both sources)
Multi-year trend:  changes within explainable bounds
```

---

### PHASE 8 — Golden Corpus + Continuous Learning 📋 QUEUED

**Golden Corpus** — verified documents with ground-truth values.
CI tests assert extraction matches ground truth on every commit.
No regression without failing test.

Minimum corpus:
- 5 Form 1065 (different industries, multiple years)
- 3 Form 1120 / 3 Form 1120S / 3 Form 1040 with Schedule C
- 2 audited / 2 reviewed financial statements
- 1 complex multi-entity deal with K-1s to personal returns

**Continuous Learning Loop**
Every exception → logs original, correct values, what failed.
Nightly analysis: which fields, which doc types, which industries fail most.
High-frequency patterns flag extraction rules for improvement.
Target: <2% exception rate on standard tax returns within 12 months.

---

### PHASE 9 — Full Commercial Banking Relationship 📋 FUTURE

**Three Pillars:** Loans (current) + Deposits + Treasury

**Relationship Pricing:** Full relationship value in credit and pricing.
Legal compliant bundling. Not tying.

**Crypto Lending:** Trigger price indexing. Margin call automation.
Digital asset custody integration.

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

Ground truth (verified and passing golden fixture tests as of Phase 3):
- 2022: Revenue 797,989 | COGS 0 | GP 797,989 | OBI 325,912 | Depr 191,385
- 2024: Revenue 1,502,871 | COGS 449,671 | GP 1,053,200 | OBI 269,816 | Depr 287,050

---

## Definition of Done — God Tier

1. **AUTO-VERIFIED on 95%+ of clean tax returns** — zero human data verification
2. **IRS identity checks pass** on every extracted document ✅ BUILT
3. **Multi-source corroboration** confirms key facts independently
4. **Reasonableness engine** catches impossible and anomalous values
5. **Formula accuracy** — every spread line mathematically verifiable ✅ BUILT
6. **Full provenance** — every number traces to document, page, line, method
7. **Golden corpus tests** pass on every commit, every document type
8. **Continuous learning** — exception rate drops measurably each quarter
9. **Audit certificate** generated for every AUTO-VERIFIED spread
10. **Banker experience** — opens a spread, trusts the numbers, focuses on credit

---

## Build Principles

- No inline math in templates. All formulas route through evaluateMetric().
- No duplicate formulas. Metric registry is the single source of truth.
- Facts are the single data interchange format. Never bypass the fact layer.
- Migrations are additive only. Never DROP or alter existing columns.
- RLS on every table. No exceptions.
- Snapshot immutability. deal_model_snapshots is INSERT-only.
- Validation errors are never fatal. They log, they flag, they never block.
- Proof beats trust. Never trust extracted data — prove it or re-extract.

---

## Progress Tracker

| Phase | Description | Status | PR |
|-------|-------------|--------|----|
| 1 | IRS Knowledge Base | ✅ Complete | #169 |
| 2 | Wire Validator to Pipeline | ✅ Complete | #170 |
| 3 | Formula Accuracy Fixes | ✅ Complete | #171 |
| 4 | Proof-of-Correctness Engine | 🔄 Next | — |
| 5 | Financial Intelligence Layer | 📋 Queued | — |
| 6 | Industry Intelligence | 📋 Queued | — |
| 7 | Cross-Document Reconciliation | 📋 Queued | — |
| 8 | Golden Corpus + Learning | 📋 Queued | — |
| 9 | Full Banking Relationship | 📋 Future | — |

*Every PR advances at least one phase. Every phase makes Buddy more accurate,
more autonomous, and more valuable. The mission: a system that proves itself
right before delivery — so bankers can focus entirely on credit judgment.*
