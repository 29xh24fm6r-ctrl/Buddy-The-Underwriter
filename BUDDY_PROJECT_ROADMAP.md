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
Golden Corpus + Continuous Learning        🔄 Phase 8 IN PROGRESS
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
Financial sanity checks with NAICS-calibrated industry norms.

**Gate 4 — Confidence Threshold** ✅ BUILT (Phase 4)
All extracted values must score ≥ 0.92 for AUTO-VERIFIED status.

**Cross-Document Layer** ✅ BUILT (Phase 7)
K-1s reconcile to entity OBI. Balance sheets balance. Ownership sums to 100%.

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
  interest-in-COGS warning
- `officerCompEngine.ts` — EXTREME_HIGH/LOW flags, excess comp add-back,
  distribution proxy detection
- `globalCashFlowBuilder.ts` — multi-entity assembly, ownership pct allocation,
  debt obligation netting
- `scheduleM1Engine.ts` — book-to-tax bridge, timing differences
- 7/7 tests. Zero regressions. tsc clean.

---

### PHASE 6 — Industry Intelligence ✅ COMPLETE
**PR #174 — commit 1c6197c4**

13 files, 848 additions. All pure data and functions. No DB required.

- 7 NAICS profiles: Maritime (487210), Real Estate (531x), Medical (621x),
  Construction (236-238), Retail (44-45), Restaurant (722x),
  Professional Services (541x), plus broad default
- `naicsMapper.ts` — prefix-based NAICS → profile routing
- `reasonablenessEngine.ts` updated — NAICS-calibrated norms when profile provided
- 10/10 tests. Zero regressions. tsc clean.

---

### PHASE 7 — Cross-Document Reconciliation ✅ COMPLETE
**PR #175 — commit cccc4eee**

11 files, 1028 additions. Migration live in Supabase.

- 6 reconciliation checks: K-1↔Entity, K-1↔Personal, Tax↔Financials,
  Balance Sheet, Multi-Year Trend, Ownership Integrity
- All check files pure functions. `dealReconciliator.ts` server-only orchestrator.
- CLEAN / FLAGS / CONFLICTS deal-level status
- Aegis findings written for HARD failures and SOFT flag sets
- Migration: `deal_reconciliation_results` table with RLS
- 12/12 tests. Zero regressions. tsc clean.

---

### PHASE 8 — Golden Corpus + Continuous Learning 🔄 NEXT

**Objective:** Make every accuracy guarantee testable and self-improving.

Phases 1-7 built the intelligence. Phase 8 proves it works on real documents,
catches regressions automatically, and closes the loop so every analyst
correction makes the system smarter.

After Phase 8, no PR can silently break extraction accuracy. The CI suite
will fail. Buddy gets measurably better over time without manual intervention.

---

**Part A: Golden Corpus Test Infrastructure**

`src/lib/corpus/`

The golden corpus is a set of verified financial documents with ground-truth
fact values. Every commit, automated tests extract from these documents and
assert the results match known-correct values. If any extraction changes,
the test fails — the developer must either fix the regression or explicitly
update the ground truth with justification.

**FILE: src/lib/corpus/types.ts**

```typescript
export type CorpusDocument = {
  id: string                    // stable identifier, e.g. "samaritus_2022_1065"
  displayName: string
  formType: string
  taxYear: number
  naicsCode: string | null
  industry: string
  groundTruth: Record<string, number | null>   // canonicalKey → expected value
  tolerances?: Record<string, number>          // per-key tolerance, default $1
  notes: string                                // why this document is in the corpus
}

export type CorpusTestResult = {
  documentId: string
  passed: boolean
  failures: Array<{
    factKey: string
    expected: number | null
    actual: number | null
    delta: number | null
    tolerance: number
  }>
  testedAt: string
}
```

**FILE: src/lib/corpus/goldenDocuments.ts**

Seed the corpus with known-good values from real deals.
Start with the two Samaritus documents (already manually verified):

```typescript
export const GOLDEN_CORPUS: CorpusDocument[] = [
  {
    id: "samaritus_2022_1065",
    displayName: "Samaritus Management LLC — Form 1065 (2022)",
    formType: "FORM_1065",
    taxYear: 2022,
    naicsCode: "487210",
    industry: "Maritime / Charter Boats",
    groundTruth: {
      GROSS_RECEIPTS: 797989,
      COST_OF_GOODS_SOLD: 0,
      GROSS_PROFIT: 797989,
      TOTAL_DEDUCTIONS: 472077,
      ORDINARY_BUSINESS_INCOME: 325912,
      DEPRECIATION: 191385,
      INTEREST_EXPENSE: 9068,
      // EBITDA computed: 325912 + 191385 + 9068 = 526365
    },
    notes: "First verified deal in production. Service business, no COGS. Maritime industry. Used to catch OBI-as-revenue bug in Phase 1."
  },
  {
    id: "samaritus_2024_1065",
    displayName: "Samaritus Management LLC — Form 1065 (2024)",
    formType: "FORM_1065",
    taxYear: 2024,
    naicsCode: "487210",
    industry: "Maritime / Charter Boats",
    groundTruth: {
      GROSS_RECEIPTS: 1502871,
      COST_OF_GOODS_SOLD: 449671,
      GROSS_PROFIT: 1053200,
      TOTAL_DEDUCTIONS: 783384,
      ORDINARY_BUSINESS_INCOME: 269816,
      DEPRECIATION: 287050,
      INTEREST_EXPENSE: 12112,
    },
    notes: "2024 return uses Line 23 for OBI (vs Line 22 in 2022). COGS present — manufacturing/service hybrid. Revenue ~88% growth YOY triggers soft trend flag."
  }
]
```

As new deals close and are verified, add their ground truth here.
Target minimum corpus by end of Phase 8:
- 5 Form 1065 (different industries, different years)
- 3 Form 1120 or 1120S
- 2 Schedule C
- 1 multi-entity deal with K-1s

**FILE: src/lib/corpus/corpusValidator.ts**
Pure function.

```typescript
export function validateAgainstCorpus(
  corpusDoc: CorpusDocument,
  extractedFacts: Record<string, number | null>
): CorpusTestResult
```

For each key in `groundTruth`:
- Get tolerance: `corpusDoc.tolerances?.[key] ?? 1`
- Compare extracted value to expected
- PASSED if `Math.abs(extracted - expected) <= tolerance` or both null
- FAILED if delta exceeds tolerance or one is null and other is not

**Tests: src/lib/corpus/__tests__/corpus.test.ts**

Test 1: Samaritus 2022 — all ground truth keys pass (use hardcoded fact map)
Test 2: Samaritus 2024 — all ground truth keys pass (use hardcoded fact map)
Test 3: Introduced regression — GROSS_PROFIT wrong → test fails, delta reported
Test 4: OBI-as-revenue regression — GROSS_RECEIPTS = 269816 (OBI value) → fails
Test 5: Missing fact → delta reported, test fails unless groundTruth value is null

---

**Part B: Continuous Learning Loop**

`src/lib/learningLoop/`

Every time an analyst corrects an extracted value, that correction is logged.
Nightly analysis identifies which fields and document types are corrected most
frequently. High-frequency patterns surface as improvement candidates.

**FILE: src/lib/learningLoop/types.ts**

```typescript
export type CorrectionEvent = {
  id: string
  dealId: string
  documentId: string
  documentType: string
  taxYear: number | null
  naicsCode: string | null
  factKey: string
  originalValue: number | null
  correctedValue: number | null
  correctionSource: "ANALYST_MANUAL" | "CORPUS_OVERRIDE" | "RE_EXTRACTION"
  analystId: string | null
  correctedAt: string
}

export type CorrectionPattern = {
  factKey: string
  documentType: string
  correctionCount: number
  errorRate: number           // corrections / total extractions for this key+docType
  avgDelta: number | null     // average magnitude of corrections
  trend: "IMPROVING" | "STABLE" | "DEGRADING"
  lastSeen: string
  flaggedForReview: boolean   // true when errorRate > 0.05 (5%)
}
```

**FILE: src/lib/learningLoop/correctionLogger.ts**
Server-only. Writes correction events.

```typescript
export async function logCorrection(event: Omit<CorrectionEvent, "id">): Promise<void>
```

Inserts to `extraction_correction_log` table.
Never throws — fire-and-forget.
Emits ledger event `extraction.analyst_correction` with factKey and delta.

**FILE: src/lib/learningLoop/patternAnalyzer.ts**
Pure function — takes correction events, returns patterns.

```typescript
export function analyzePatterns(
  corrections: CorrectionEvent[],
  totalExtractionsByKeyAndType: Record<string, number>
): CorrectionPattern[]
```

Groups by `factKey + documentType`.
Computes errorRate = corrections / totalExtractions.
Flags for review when errorRate > 0.05.
Trend: compare last-30-days rate to prior-30-days rate.

**FILE: src/lib/learningLoop/patternReporter.ts**
Server-only. Queries DB, runs analyzer, writes report.

```typescript
export async function generateDailyPatternReport(asOfDate: string): Promise<{
  patterns: CorrectionPattern[]
  topErrors: CorrectionPattern[]    // top 5 by errorRate
  newFlags: CorrectionPattern[]     // newly crossed 5% threshold since last report
  improvingFields: CorrectionPattern[]
}>
```

Writes report to `extraction_learning_reports` table.
Writes Aegis finding for each newly flagged field (severity MEDIUM).

**MIGRATION:**

```sql
CREATE TABLE IF NOT EXISTS extraction_correction_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL,
  document_id UUID NOT NULL,
  document_type TEXT NOT NULL,
  tax_year INTEGER,
  naics_code TEXT,
  fact_key TEXT NOT NULL,
  original_value NUMERIC,
  corrected_value NUMERIC,
  correction_source TEXT NOT NULL,
  analyst_id TEXT,
  corrected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_correction_log_fact_key
  ON extraction_correction_log(fact_key);
CREATE INDEX IF NOT EXISTS idx_correction_log_document_type
  ON extraction_correction_log(document_type, fact_key);
CREATE INDEX IF NOT EXISTS idx_correction_log_corrected_at
  ON extraction_correction_log(corrected_at);
ALTER TABLE extraction_correction_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON extraction_correction_log
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "authenticated_read" ON extraction_correction_log
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE TABLE IF NOT EXISTS extraction_learning_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date DATE NOT NULL,
  patterns JSONB NOT NULL DEFAULT '[]',
  top_errors JSONB NOT NULL DEFAULT '[]',
  new_flags JSONB NOT NULL DEFAULT '[]',
  improving_fields JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_reports_date
  ON extraction_learning_reports(report_date);
ALTER TABLE extraction_learning_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON extraction_learning_reports
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "authenticated_read" ON extraction_learning_reports
  FOR SELECT USING (auth.role() = 'authenticated');
```

**Tests: src/lib/learningLoop/__tests__/learningLoop.test.ts**

Test 1: validateAgainstCorpus passes for correct facts
Test 2: validateAgainstCorpus fails and reports delta for wrong facts
Test 3: analyzePatterns — flags field when errorRate > 5%
Test 4: analyzePatterns — IMPROVING trend when recent rate lower than prior
Test 5: analyzePatterns — DEGRADING trend when recent rate higher than prior
Test 6: analyzePatterns — fields with 0 corrections return empty patterns

**ACCEPTANCE CRITERIA:**
- tsc --noEmit clean
- All tests pass (corpus + learning loop)
- All existing tests pass — zero regressions
- corpus/ files are pure (no DB, no server-only)
- learningLoop/correctionLogger.ts and patternReporter.ts are server-only
- patternAnalyzer.ts is pure
- Both migrations apply cleanly
- logCorrection never throws

**PR TITLE:**
`feat: Golden Corpus + Continuous Learning — regression protection and analyst feedback loop`

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

Ground truth (verified, in golden corpus as of Phase 8):
- 2022: Revenue 797,989 | COGS 0 | GP 797,989 | OBI 325,912 | Depr 191,385
- 2024: Revenue 1,502,871 | COGS 449,671 | GP 1,053,200 | OBI 269,816 | Depr 287,050

---

## Definition of Done — God Tier

1. **AUTO-VERIFIED on 95%+ of clean tax returns** — zero human data verification
2. **IRS identity checks pass** on every extracted document ✅ BUILT
3. **Multi-source corroboration** confirms key facts independently ✅ BUILT
4. **Reasonableness engine** with NAICS-calibrated norms ✅ BUILT
5. **Formula accuracy** — every spread line mathematically verifiable ✅ BUILT
6. **Financial intelligence** — EBITDA, officer comp, global cash flow ✅ BUILT
7. **Industry intelligence** — 7 NAICS profiles, calibrated analysis ✅ BUILT
8. **Cross-document reconciliation** — K-1s, balance sheet, ownership ✅ BUILT
9. **Golden corpus tests** pass on every commit, every document type 🔄 Phase 8
10. **Continuous learning** — error rate drops measurably each quarter 🔄 Phase 8
11. **Full provenance** — every number traces to document, page, line, method
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
| 7 | Cross-Document Reconciliation | ✅ Complete | #175 |
| 8 | Golden Corpus + Learning Loop | 🔄 Next | — |
| 9 | Full Banking Relationship | 📋 Future | — |

*Every PR advances at least one phase. Every phase makes Buddy more accurate,
more autonomous, and more valuable. The mission: a system that proves itself
right before delivery — so bankers focus entirely on credit judgment.*
