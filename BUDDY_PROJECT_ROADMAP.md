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
Industry Intelligence Layer                🔄 Phase 6 IN PROGRESS
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
Same value confirmed from two independent sources.

**Gate 3 — Reasonableness Engine** ✅ BUILT (Phase 4)
Financial sanity checks. Catches impossible and anomalous values.
Phase 6 adds NAICS-calibrated industry norms.

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
- `auditCertificate.ts` — generates and persists cryptographic proof of correctness
- `reExtractionOrchestrator.ts` — up to 3 attempts before exception queue
- Migrations: `deal_document_audit_certificates`, `deal_extraction_exceptions`
- 5/5 new tests. 116/116 existing tests. tsc clean.

---

### PHASE 5 — Financial Intelligence Layer ✅ COMPLETE
**PR #173 — commit 19099099**

All pure functions. No DB required. Used by spread generation and credit memo.

- `ebitdaEngine.ts` — standard add-backs, partnership guaranteed payments,
  non-recurring items, interest-in-COGS warning for maritime/construction
- `officerCompEngine.ts` — EXTREME_HIGH/LOW flags, excess comp add-back,
  distribution proxy detection for below-market comp
- `globalCashFlowBuilder.ts` — multi-entity income assembly, ownership pct
  allocation, debt obligation netting, global net cash flow
- `scheduleM1Engine.ts` — book-to-tax bridge, depreciation timing differences,
  meals & entertainment, significant difference flagging
- 7/7 tests. Zero regressions. tsc clean.

---

### PHASE 6 — Industry Intelligence 🔄 NEXT

**Objective:** Make every extraction and analysis decision industry-aware.
Replaces broad default norms in the Reasonableness Engine with
NAICS-calibrated norms for each industry type.

After Phase 6, a charter boat return gets evaluated against maritime norms.
A medical practice gets evaluated against healthcare norms.
The system stops treating every business the same way.

**Structure:**
`src/lib/industryIntelligence/`
- `types.ts` — IndustryProfile type definition
- `naicsMapper.ts` — NAICS code → profile lookup
- `profiles/maritime.ts` — NAICS 487210
- `profiles/realEstate.ts` — NAICS 531x
- `profiles/medical.ts` — NAICS 621x
- `profiles/construction.ts` — NAICS 236-238
- `profiles/retail.ts` — NAICS 44-45
- `profiles/restaurant.ts` — NAICS 722x
- `profiles/professionalServices.ts` — NAICS 541x
- `profiles/default.ts` — broad defaults for unknown industries
- `index.ts` — barrel + `getIndustryProfile(naicsCode)` router

**IndustryProfile type:**
```typescript
type IndustryProfile = {
  naicsCode: string
  naicsDescription: string
  displayName: string

  // Gross margin norms (0-1 as decimal)
  grossMarginNormal: { min: number; max: number }
  grossMarginAnomaly: { min: number; max: number }  // outside = soft warning

  // Where interest expense typically lives
  interestInCogs: boolean        // true = check Form 1125-A, warn if missing
  interestInCogsNote: string

  // Officer comp norms (as % of revenue)
  officerCompNormal: { min: number; max: number }

  // Depreciation expectations
  highDepreciationExpected: boolean
  depreciationNote: string

  // COGS composition notes
  cogsComponents: string[]

  // Industry-specific add-backs beyond standard
  industryAddBacks: Array<{
    key: string
    description: string
    applicability: string
  }>

  // Red flags specific to this industry
  redFlags: Array<{
    id: string
    description: string
    condition: string  // human-readable trigger condition
    severity: "HIGH" | "MEDIUM" | "LOW"
  }>

  // Credit analysis notes for the credit memo
  creditAnalysisNotes: string
}
```

**Integration point — Reasonableness Engine:**
After Phase 6, `checkReasonableness()` accepts an optional `industryProfile`
parameter. When provided, gross margin, officer comp, and depreciation checks
use profile norms instead of broad defaults.

**Key profile details to encode:**

Maritime (NAICS 487210):
- interestInCogs: TRUE — boat financing interest commonly in COGS via 1125-A
- grossMarginNormal: 0.40-0.75 (fuel, crew, marina fees in COGS)
- highDepreciationExpected: TRUE — vessels depreciate heavily
- redFlag: "Revenue < prior year by >20% without weather/seasonality explanation"

Real Estate (NAICS 531x):
- Analysis basis: NOI, not EBITDA
- grossMarginNormal: 0.55-0.85
- highDepreciationExpected: TRUE — buildings, improvements
- industryAddBack: depreciation recapture note on sale
- redFlag: "Vacancy rate implied by rent vs sq footage anomalous"

Medical (NAICS 621x):
- officerCompNormal: 0.25-0.60 (physician owners take large comp)
- industryAddBack: "Personal goodwill — physician comp above market is entity value"
- redFlag: "Accounts receivable >120 days revenue equivalent (collections issue)"

Construction (NAICS 236-238):
- interestInCogs: TRUE — equipment financing often in job costs
- grossMarginNormal: 0.15-0.35 (materials-heavy)
- redFlag: "WIP not disclosed — percentage completion accounting risk"
- redFlag: "Revenue spike >40% YOY without backlog explanation"

Restaurant (NAICS 722x):
- grossMarginNormal: 0.55-0.75 (food cost 25-40% of revenue typical)
- officerCompNormal: 0.05-0.20
- redFlag: "Food cost ratio outside 25-40% band"
- redFlag: "Labor cost >35% of revenue"

Professional Services (NAICS 541x):
- grossMarginNormal: 0.65-0.90 (low COGS, high margin)
- interestInCogs: FALSE
- redFlag: "DSO (days sales outstanding) >90 days"
- redFlag: "Revenue concentration — single client >30% of revenue"

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

Note: This deal will be the first to benefit from Phase 6 Maritime profile.
Interest-in-COGS warning already fires on 2024 return. Phase 6 will calibrate
gross margin reasonableness check to maritime norms (40-75%) vs broad defaults.

---

## Definition of Done — God Tier

1. **AUTO-VERIFIED on 95%+ of clean tax returns** — zero human data verification
2. **IRS identity checks pass** on every extracted document ✅ BUILT
3. **Multi-source corroboration** confirms key facts independently ✅ BUILT
4. **Reasonableness engine** catches impossible and anomalous values ✅ BUILT
5. **Formula accuracy** — every spread line mathematically verifiable ✅ BUILT
6. **Financial intelligence** — EBITDA, officer comp, global cash flow ✅ BUILT
7. **Industry-calibrated norms** — NAICS-aware analysis 🔄 Phase 6
8. **Full provenance** — every number traces to document, page, line, method
9. **Golden corpus tests** pass on every commit, every document type
10. **Continuous learning** — exception rate drops measurably each quarter
11. **Audit certificate** generated for every AUTO-VERIFIED spread ✅ BUILT
12. **Banker experience** — opens a spread, trusts the numbers, focuses on credit

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
| 6 | Industry Intelligence | 🔄 Next | — |
| 7 | Cross-Document Reconciliation | 📋 Queued | — |
| 8 | Golden Corpus + Learning | 📋 Queued | — |
| 9 | Full Banking Relationship | 📋 Future | — |

*Every PR advances at least one phase. Every phase makes Buddy more accurate,
more autonomous, and more valuable. The mission: a system that proves itself
right before delivery — so bankers focus entirely on credit judgment.*
