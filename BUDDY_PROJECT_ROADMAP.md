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
Cross-Document Reconciliation              ✅ Phase 7 COMPLETE
        ↓
Golden Corpus + Continuous Learning        ✅ Phase 8 COMPLETE
        ↓
Spread Generation (MMAS format)
        ↓
AUTO-VERIFIED → Banker reviews for credit judgment only
        ↓
Credit Memo + Committee Package
        ↓
Full Banking Relationship (Loans + Deposits + Treasury)  📋 Phase 9
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
**Gate 2 — Multi-Source Corroboration** ✅ BUILT (Phase 4)
**Gate 3 — Reasonableness Engine** ✅ BUILT (Phase 4 + 6)
**Gate 4 — Confidence Threshold** ✅ BUILT (Phase 4)
**Cross-Document Layer** ✅ BUILT (Phase 7)
**Regression Protection** ✅ BUILT (Phase 8)

**When all gates pass:** `AUTO-VERIFIED`. No queue. No wait.
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
- Migration: `deal_document_validation_results` with RLS

---

### PHASE 3 — Formula Accuracy Fixes ✅ COMPLETE
**PR #171**

- GROSS_PROFIT: null COGS treated as 0
- EBITDA: computed from components, never identity lookup
- OBI removed from TOTAL_REVENUE alias chain entirely
- 6/6 golden fixture tests. 49/49 existing tests. tsc clean.

Samaritus verified:
- 2022: Revenue 797,989 | COGS 0 | GP 797,989 | OBI 325,912 | EBITDA 526,365 ✓
- 2024: Revenue 1,502,871 | COGS 449,671 | GP 1,053,200 | OBI 269,816 ✓

---

### PHASE 4 — Proof-of-Correctness Engine ✅ COMPLETE
**PR #172**

- Corroboration, Reasonableness, Confidence Aggregator, Audit Certificate
- Re-extraction orchestrator — 3 attempts before exception queue
- Migrations: `deal_document_audit_certificates`, `deal_extraction_exceptions`
- 5/5 new tests. 116/116 existing. tsc clean.

---

### PHASE 5 — Financial Intelligence Layer ✅ COMPLETE
**PR #173 — commit 19099099**

All pure functions. No DB required.

- EBITDA engine, Officer Comp engine, Global Cash Flow builder, M-1 engine
- 7/7 tests. Zero regressions.

---

### PHASE 6 — Industry Intelligence ✅ COMPLETE
**PR #174 — commit 1c6197c4**

13 files, 848 additions. All pure. No DB required.

- 7 NAICS profiles + default. Prefix-based routing.
- Reasonableness engine updated with NAICS-calibrated norms.
- 10/10 tests. Zero regressions.

---

### PHASE 7 — Cross-Document Reconciliation ✅ COMPLETE
**PR #175 — commit cccc4eee**

11 files, 1028 additions.

- 6 checks: K-1↔Entity, K-1↔Personal, Tax↔Financials,
  Balance Sheet, Multi-Year Trend, Ownership Integrity
- CLEAN / FLAGS / CONFLICTS deal-level status
- Migration: `deal_reconciliation_results` with RLS
- 12/12 tests. Zero regressions.

---

### PHASE 8 — Golden Corpus + Continuous Learning ✅ COMPLETE
**PR #176**

Part A — Golden Corpus (`src/lib/corpus/`):
- `CorpusDocument` + `CorpusTestResult` types
- 2 verified Samaritus documents (2022 + 2024) with ground truth
- Pure `validateAgainstCorpus()` with per-key tolerance

Part B — Continuous Learning Loop (`src/lib/learningLoop/`):
- `correctionLogger.ts` — server-only, fire-and-forget, ledger event emission
- `patternAnalyzer.ts` — pure, groups by factKey+docType, 5% flagging threshold,
  IMPROVING/STABLE/DEGRADING trend detection
- `patternReporter.ts` — server-only, daily reports, Aegis findings for new flags
- Migrations: `extraction_correction_log`, `extraction_learning_reports` with RLS
- 11 new tests (5 corpus + 6 learning). 34 existing. 45/45 pass. tsc clean.

---

### PHASE 9 — Full Commercial Banking Relationship 📋 NEXT

**Objective:** Expand Buddy from loan underwriting to the full commercial
banking officer workflow across all three revenue pillars.

Commercial bankers don't just make loans. They manage the full relationship:
deposits, treasury services, and loans together. A banker who only thinks
about the loan is leaving revenue on the table and missing the full picture
of the borrower's financial health. Buddy should see what the banker sees.

**The Three Pillars:**

**Pillar 1 — Loans (current)**
Credit analysis, underwriting, risk assessment. Phases 1-8 are all here.
The foundation is complete. This pillar is production-ready.

**Pillar 2 — Deposits**
Operating account analysis surfaced during loan underwriting:
- Average daily balance trends (from bank statements already collected)
- Account volatility (standard deviation of daily balances)
- Seasonal patterns that affect liquidity and credit risk
- Deposit relationship value quantified for pricing decisions
- Low-balance periods that indicate cash flow stress (credit signal)

When Buddy processes bank statements for a loan, it automatically builds
a deposit profile. The banker sees both the credit story and the deposit
opportunity in the same workflow.

**Pillar 3 — Treasury**
Auto-generated treasury proposals from financial data already collected:
- Lockbox services (when AR >60 days — collection acceleration opportunity)
- ACH origination (when payroll or vendor payments visible in statements)
- Positive pay (when check volume suggests fraud risk exposure)
- Sweep accounts (when excess liquidity visible in average balance analysis)
- Remote deposit capture (when deposit frequency and volume warrant it)

Each treasury proposal includes: why it's recommended (data-driven),
estimated fee revenue for the bank, and borrower benefit framing.
This is not a sales pitch generator — it is a data-driven opportunity map.

**Relationship Pricing Module**
When all three pillars are analyzed, compute the full relationship value:
- Loan spread contribution
- Deposit balance earnings credit
- Treasury fee revenue
- Total relationship profitability

Use relationship profitability to inform loan pricing decisions:
a deep deposit relationship justifies a tighter loan spread.
This is relationship pricing — legally compliant under Bank Holding Company
Act Section 106 because treasury and deposit products are recommended on
their own merit, not conditioned on the loan.

**Crypto Lending Extension**
Real-time collateral monitoring for digital asset-backed loans:
- Trigger price indexing — not continuous polling (computationally efficient)
- Tiered monitoring: standard check intervals tighten as LTV approaches margin call
- Margin call notification workflow with cure period tracking
- Auto-liquidation authorization framework with human approval gate
- Supabase schema extensions for collateral tracking
- Integration hooks for digital asset custody platform APIs

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

Ground truth (verified, in golden corpus):
- 2022: Revenue 797,989 | COGS 0 | GP 797,989 | OBI 325,912 | Depr 191,385
- 2024: Revenue 1,502,871 | COGS 449,671 | GP 1,053,200 | OBI 269,816 | Depr 287,050

---

## Definition of Done — God Tier

1. **AUTO-VERIFIED on 95%+ of clean tax returns** — zero human data verification
2. **IRS identity checks** on every extracted document ✅ BUILT
3. **Multi-source corroboration** from independent sources ✅ BUILT
4. **Reasonableness engine** with NAICS-calibrated norms ✅ BUILT
5. **Formula accuracy** — every spread line mathematically verifiable ✅ BUILT
6. **Financial intelligence** — EBITDA, officer comp, global cash flow ✅ BUILT
7. **Industry intelligence** — 7 NAICS profiles ✅ BUILT
8. **Cross-document reconciliation** — K-1s, balance sheet, ownership ✅ BUILT
9. **Golden corpus tests** pass on every commit ✅ BUILT
10. **Continuous learning** — error rate drops measurably each quarter ✅ BUILT
11. **Audit certificate** for every AUTO-VERIFIED spread ✅ BUILT
12. **Full provenance** — every number traces to document, page, line, method
13. **Full relationship view** — loans + deposits + treasury in one workflow
14. **Banker experience** — opens a spread, trusts the numbers, focuses on credit

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
| 7 | Cross-Document Reconciliation | ✅ Complete | #175 |
| 8 | Golden Corpus + Learning Loop | ✅ Complete | #176 |
| 9 | Full Banking Relationship | 🔄 Next | — |

*Every PR advances at least one phase. Every phase makes Buddy more accurate,
more autonomous, and more valuable. The mission: a system that proves itself
right before delivery — so bankers focus entirely on credit judgment.*
