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
Proof-of-Correctness Engine                ✅ Phase 4 COMPLETE
        ↓
Financial Intelligence Layer               ✅ Phase 5 COMPLETE
        ↓
Industry Intelligence Layer                ✅ Phase 6 COMPLETE
        ↓
Cross-Document Reconciliation              🔄 Phase 7 IN PROGRESS
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

**Gate 1 — IRS Identity Checks** ✅ BUILT (Phase 1)
Mathematical proof that extracted numbers are internally consistent.

**Gate 2 — Multi-Source Corroboration** ✅ BUILT (Phase 4)
Same value confirmed from two independent sources within the document set.

**Gate 3 — Reasonableness Engine** ✅ BUILT (Phase 4 + 6)
Financial sanity checks with NAICS-calibrated industry norms (Phase 6).

**Gate 4 — Confidence Threshold** ✅ BUILT (Phase 4)
All extracted values must score ≥ 0.92 for AUTO-VERIFIED status.

**When all four pass:** `AUTO-VERIFIED`. No queue. No wait.
**Target: 95%+ of clean tax returns AUTO-VERIFIED with zero human touch.**

---

## Roadmap

---

### PHASE 1 — IRS Knowledge Base Foundation ✅ COMPLETE
**PR #169**

- 57 canonical fact keys, 20 IRS form types, document trust hierarchy
- Form 1065 (2021-2024), Form 1120/1120S, Schedule C
- Identity validator: VERIFIED / FLAGGED / BLOCKED / PARTIAL
- 5/5 tests. Catches OBI-as-revenue production bug.

---

### PHASE 2 — Wire Validator Into Extraction Pipeline ✅ COMPLETE
**PR #170 — commit 508f24f1**

- `postExtractionValidator.ts` — fires after every extraction, never throws
- `runRecord.ts` — dynamic import hook, fire-and-forget
- Spread route returns `validationGate` on every response
- Migration: `deal_document_validation_results` table with RLS

---

### PHASE 3 — Formula Accuracy Fixes ✅ COMPLETE
**PR #171**

- GROSS_PROFIT: null COGS treated as 0 (service businesses fixed)
- EBITDA: computed from components, never identity lookup
- OBI removed from TOTAL_REVENUE alias chain entirely
- 6/6 golden fixture tests. 49/49 existing tests. tsc clean.

Samaritus verified:
- 2022: Revenue 797,989 | COGS 0 | GP 797,989 | OBI 325,912 | EBITDA 526,365 ✓
- 2024: Revenue 1,502,871 | COGS 449,671 | GP 1,053,200 | OBI 269,816 ✓

---

### PHASE 4 — Proof-of-Correctness Engine ✅ COMPLETE
**PR #172**

- `corroborationEngine.ts` — cross-checks key facts against secondary sources
- `reasonablenessEngine.ts` — hard failures (IMPOSSIBLE) and soft warnings (ANOMALOUS)
- `confidenceAggregator.ts` — document-level score, AUTO_VERIFIED threshold 0.92
- `auditCertificate.ts` — cryptographic proof of correctness, OCC-auditable
- `reExtractionOrchestrator.ts` — up to 3 attempts before exception queue
- Migrations: `deal_document_audit_certificates`, `deal_extraction_exceptions`
- 5/5 new tests. 116/116 existing tests. tsc clean.

---

### PHASE 5 — Financial Intelligence Layer ✅ COMPLETE
**PR #173 — commit 19099099**

All pure functions. No DB required.

- `ebitdaEngine.ts` — standard add-backs, guaranteed payments, non-recurring,
  interest-in-COGS warning for maritime/construction
- `officerCompEngine.ts` — EXTREME_HIGH/LOW flags, excess comp add-back,
  distribution proxy detection
- `globalCashFlowBuilder.ts` — multi-entity assembly, ownership pct allocation,
  debt obligation netting
- `scheduleM1Engine.ts` — book-to-tax bridge, timing differences, significant
  difference flagging
- 7/7 tests. Zero regressions. tsc clean.

---

### PHASE 6 — Industry Intelligence ✅ COMPLETE
**PR #174 — commit 1c6197c4**

13 files, 848 additions. All pure data and functions. No DB required.

- `IndustryProfile` type — gross margin norms, interest-in-COGS flag,
  officer comp norms, depreciation expectations, red flags, credit notes
- 7 industry profiles: Maritime (487210), Real Estate (531x), Medical (621x),
  Construction (236-238), Retail (44-45), Restaurant (722x),
  Professional Services (541x)
- `default.ts` — broad defaults for unknown NAICS
- `naicsMapper.ts` — prefix-based NAICS → profile routing
- `reasonablenessEngine.ts` updated — backward-compatible `industryProfile`
  parameter, NAICS-calibrated norms when profile provided
- 10/10 tests. Zero regressions. tsc clean.

---

### PHASE 7 — Cross-Document Reconciliation 🔄 NEXT

**Objective:** Catch inconsistencies that single-document validation cannot see.

A borrower who files a Form 1065 also issues K-1s to partners, and those
partners report that K-1 income on their personal returns. The same dollar
of income appears in three places. If any of the three disagree, something
is wrong — mismatched ownership percentages, unreported income, or an
extraction error. This phase catches all of it.

**What reconciliation means at the deal level:**
After all documents in a deal are extracted and individually validated,
cross-document reconciliation runs once across the full package.
It is the final accuracy gate before spread generation.

**Reconciliation checks to implement:**

```
CHECK 1 — K-1 to Entity Return
  sum(k1_ordinary_income_i × ownership_pct_i for all partners i)
  ≈ entity_ordinary_business_income
  Tolerance: $1
  Required: entity OBI + at least one K-1 with ownership pct

CHECK 2 — K-1 to Personal Return
  k1_income_on_personal_return
  ≈ k1_income_on_entity_return × reported_ownership_pct
  Tolerance: 1% of value or $100, whichever is larger
  Required: personal return K-1 line + entity K-1 for same EIN

CHECK 3 — Tax Return to Financial Statement
  tax_return_gross_receipts ≈ income_statement_revenue
  Tolerance: 5% of value (accounting method differences are real)
  Required: both a tax return and financial statement for same entity/year

CHECK 4 — Balance Sheet Reconciliation
  total_assets ≈ total_liabilities + total_equity
  Tolerance: $1
  Required: balance sheet data from any source (Schedule L, financial stmt)
  Applies per source — flag if balance sheet from any source doesn't balance

CHECK 5 — Multi-Year Revenue Trend
  |revenue_change_yoy| within explainable bounds for industry
  Threshold: use industryProfile.grossMarginNormal when available, else >50% = flag
  Required: at least 2 years of the same entity's returns
  Not a hard failure — soft flag for analyst attention

CHECK 6 — Ownership Percentage Integrity
  sum(all_partner_ownership_pcts) ≈ 1.00 (100%)
  Tolerance: 1% rounding
  Required: K-1s for all partners in a partnership
  Flag if K-1 set appears incomplete (sum < 0.95)
```

**Structure:**
`src/lib/reconciliation/`
- `types.ts` — ReconciliationCheck, ReconciliationResult, DealReconciliationSummary
- `k1ToEntityCheck.ts` — CHECK 1
- `k1ToPersonalCheck.ts` — CHECK 2
- `taxToFinancialsCheck.ts` — CHECK 3
- `balanceSheetCheck.ts` — CHECK 4
- `multiYearTrendCheck.ts` — CHECK 5
- `ownershipIntegrityCheck.ts` — CHECK 6
- `dealReconciliator.ts` — orchestrator, runs all applicable checks
- `index.ts` — barrel export

All check files pure functions. `dealReconciliator.ts` is the only file that
touches DB (loads facts for all documents in a deal package).

**DealReconciliationSummary type:**
```typescript
type DealReconciliationSummary = {
  dealId: string
  checksRun: number
  checksPassed: number
  checksFailed: number
  checksSkipped: number
  hardFailures: ReconciliationCheck[]    // block spread or require sign-off
  softFlags: ReconciliationCheck[]       // note in spread, don't block
  overallStatus: "CLEAN" | "FLAGS" | "CONFLICTS"
  reconciledAt: string
}
```

CLEAN = all applicable checks passed
FLAGS = only soft flags (trend anomalies, ownership gaps)
CONFLICTS = any hard failure (K-1 sum mismatch, balance sheet out of balance)

---

### PHASE 8 — Golden Corpus + Continuous Learning 📋 QUEUED

**Golden Corpus** — verified documents with ground-truth values.
CI tests assert extraction matches ground truth on every commit.

Minimum corpus:
- 5 Form 1065 (different industries, multiple years)
- 3 Form 1120 / 3 Form 1120S / 3 Form 1040 with Schedule C
- 2 audited / 2 reviewed financial statements
- 1 complex multi-entity deal with K-1s to personal returns

**Continuous Learning Loop**
Every exception → logs original vs correct values and what failed.
Nightly: high-frequency error patterns flag extraction rules for improvement.
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
Charter boat business, Florida — NAICS 487210 (Maritime)
Deal ID: 04312437-2bf3-4f72-b1eb-464a2b1bedc5

Ground truth (verified, passing golden fixture tests):
- 2022: Revenue 797,989 | COGS 0 | GP 797,989 | OBI 325,912 | Depr 191,385
- 2024: Revenue 1,502,871 | COGS 449,671 | GP 1,053,200 | OBI 269,816 | Depr 287,050

Phase 7 note: This deal has 2 years of returns from the same entity.
Multi-year trend check (CHECK 5) will run and validate YOY revenue change
against Maritime profile norms (~88% revenue growth 2022→2024 — will trigger
soft flag for analyst awareness, which is correct behavior).

---

## Definition of Done — God Tier

1. **AUTO-VERIFIED on 95%+ of clean tax returns** — zero human data verification
2. **IRS identity checks pass** on every extracted document ✅ BUILT
3. **Multi-source corroboration** confirms key facts independently ✅ BUILT
4. **Reasonableness engine** with NAICS-calibrated norms ✅ BUILT
5. **Formula accuracy** — every spread line mathematically verifiable ✅ BUILT
6. **Financial intelligence** — EBITDA, officer comp, global cash flow ✅ BUILT
7. **Industry intelligence** — 7 NAICS profiles, calibrated analysis ✅ BUILT
8. **Cross-document reconciliation** — K-1s, personal returns, financials 🔄 Phase 7
9. **Full provenance** — every number traces to document, page, line, method
10. **Golden corpus tests** pass on every commit, every document type
11. **Continuous learning** — exception rate drops measurably each quarter
12. **Audit certificate** generated for every AUTO-VERIFIED spread ✅ BUILT
13. **Banker experience** — opens a spread, trusts the numbers, focuses on credit

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
- Pure functions first. DB access in thin service layers only.

---

## Progress Tracker

| Phase | Description | Status | PR |
|-------|-------------|--------|----|
| 1 | IRS Knowledge Base | ✅ Complete | #169 |
| 2 | Wire Validator to Pipeline | ✅ Complete | #170 |
| 3 | Formula Accuracy Fixes | ✅ Complete | #171 |
| 4 | Proof-of-Correctness Engine | ✅ Complete | #172 |
| 5 | Financial Intelligence Layer | ✅ Complete | #173 |
| 6 | Industry Intelligence | ✅ Complete | #174 |
| 7 | Cross-Document Reconciliation | 🔄 Next | — |
| 8 | Golden Corpus + Learning | 📋 Queued | — |
| 9 | Full Banking Relationship | 📋 Future | — |

*Every PR advances at least one phase. Every phase makes Buddy more accurate,
more autonomous, and more valuable. The mission: a system that proves itself
right before delivery — so bankers focus entirely on credit judgment.*
