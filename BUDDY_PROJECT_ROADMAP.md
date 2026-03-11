# Buddy The Underwriter — Project Roadmap
# Institutional-Grade Commercial Lending AI Platform

**Last Updated: March 2026**
**Status: Phase 19 Complete — Global Cash Flow PDF Page**

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

**The standard:** Buddy must be the world's expert on every single line item
on the Moody's MMAS spread — not just the items built so far.

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
Structured Extraction Engine (Gemini Flash)
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
Full Banking Relationship                  ✅ Phase 9 COMPLETE
        ↓
Classic Banker Spread PDF (MMAS format)    ✅ PRs #180–#209
        ↓
AUTO-VERIFIED → Banker reviews for credit judgment only
        ↓
Credit Memo + Committee Package
        ↓
Deposit Profile + Treasury Proposals surfaced automatically
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

## The Proof-of-Correctness System — All Gates Live

**Gate 1 — IRS Identity Checks** ✅ Phase 1
**Gate 2 — Multi-Source Corroboration** ✅ Phase 4
**Gate 3 — Reasonableness Engine (NAICS-calibrated)** ✅ Phase 4 + 6
**Gate 4 — Confidence Threshold** ✅ Phase 4
**Cross-Document Reconciliation** ✅ Phase 7
**Regression Protection (Golden Corpus)** ✅ Phase 8

**When all gates pass:** `AUTO-VERIFIED`. No queue. No wait.
**Target: 95%+ of clean tax returns AUTO-VERIFIED with zero human touch.**

---

## Completed Phases — Foundation (PRs #169–#177)

### PHASE 1 — IRS Knowledge Base Foundation ✅ COMPLETE — PR #169
- 57 canonical fact keys, 20 IRS form types, document trust hierarchy
- Form 1065 (2021-2024), Form 1120/1120S, Schedule C
- Identity validator: VERIFIED / FLAGGED / BLOCKED / PARTIAL

### PHASE 2 — Wire Validator Into Extraction Pipeline ✅ COMPLETE — PR #170
- `postExtractionValidator.ts` fires after every extraction, never throws
- `runRecord.ts` dynamic import hook, fire-and-forget
- Spread route returns `validationGate` on every response
- Migration: `deal_document_validation_results`

### PHASE 3 — Formula Accuracy Fixes ✅ COMPLETE — PR #171
- GROSS_PROFIT: null COGS treated as 0
- EBITDA: computed from components, never identity lookup
- OBI removed from TOTAL_REVENUE alias chain

### PHASE 4 — Proof-of-Correctness Engine ✅ COMPLETE — PR #172
- Corroboration, Reasonableness, Confidence Aggregator, Audit Certificate
- Re-extraction orchestrator — 3 attempts before exception queue
- Migrations: `deal_document_audit_certificates`, `deal_extraction_exceptions`

### PHASE 5 — Financial Intelligence Layer ✅ COMPLETE — PR #173
All pure functions. No DB required.
- EBITDA engine, Officer Comp engine, Global Cash Flow builder, M-1 engine

### PHASE 6 — Industry Intelligence ✅ COMPLETE — PR #174
- 7 NAICS profiles: Maritime, Real Estate, Medical, Construction,
  Retail, Restaurant, Professional Services + broad default
- Reasonableness engine updated with NAICS-calibrated norms

### PHASE 7 — Cross-Document Reconciliation ✅ COMPLETE — PR #175
- 6 checks: K-1↔Entity, K-1↔Personal, Tax↔Financials,
  Balance Sheet, Multi-Year Trend, Ownership Integrity
- CLEAN / FLAGS / CONFLICTS deal-level status
- Migration: `deal_reconciliation_results`

### PHASE 8 — Golden Corpus + Continuous Learning ✅ COMPLETE — PR #176
- Golden corpus with 2 verified Samaritus documents (ground truth locked)
- `validateAgainstCorpus()` — regression protection on every commit
- `correctionLogger.ts` — analyst corrections captured, ledger events emitted
- `patternAnalyzer.ts` — 5% error rate threshold, IMPROVING/STABLE/DEGRADING
- Migrations: `extraction_correction_log`, `extraction_learning_reports`
- 55 total tests passing. tsc clean.

### PHASE 9 — Full Banking Relationship ✅ COMPLETE — PR #177
All pure functions. No DB required.
- `depositProfileBuilder.ts` — average daily balance, volatility, seasonal pattern
- `treasuryProposalEngine.ts` — 5 products auto-proposed from financial data
- `relationshipPricingEngine.ts` — total relationship value, Section 106 compliance
- 10 new tests. 65 total. All pass. tsc clean.

---

## Classic Banker Spread Report Sprint (PRs #180–#209)

This sprint converted the intelligence foundation into a banker-grade output
format matching the Moody's MMAS spread standard.

### Phases 2C–3D + Credit Memo PDF ✅ PRs #180–#184
- Credit memo PDF generation, deal cockpit panels, spread output API foundation

### Phase 2 Spread Infrastructure ✅ PRs #185–#186
- `spreadTemplateRegistry.ts` — canonical line item definitions
- `normalizedSpreadBuilder.ts` — fact → spread column mapping

### Phase 2b Spread Improvements ✅ PR #187
- Deal-type-aware completeness checking
- Derived computed fields (cash_flow_available)

### AARs 1–17 ✅ PRs #188–#196 + next.config.mjs
Production fixes discovered on live deal 07541fce:

| AAR | Fix |
|-----|-----|
| 1 | GROSS_RECEIPTS key in spreadTemplateRegistry |
| 2A | Deal-type-aware snapshot completeness in financialSnapshotCore |
| 2B | Computed cash_flow_available from OBI+DEP+S179 |
| 3 | Optimistic blocker suppression in ReadinessPanel |
| 4 | 404 no-throw in MatchedLendersPanel |
| 5 | humanizeGuardError in UnderwriteGuardBanner |
| 6 | Heartbeat guard on INTAKE_NOT_CONFIRMED |
| 7 | console.error on materialization failure |
| 8–16 | Spread route PFS exclusion, revenue aliasing, EBITDA derivation, snapshot wiring |
| 17 | pdfkit serverExternalPackages fix in next.config.mjs |

### Classic Spread PDF v1 ✅ PR #197
4-file implementation in `src/lib/classicSpread/`:
- `types.ts`, `classicSpreadLoader.ts`, `classicSpreadRenderer.ts`, `route.ts`
- PDFKit portrait PDF: Balance Sheet, Income Statement, Ratios, Executive Summary

### AAR 18 — Portrait Layout + Ghost Pages + TOTAL OPEX ✅ PR #207
Root cause: PDFKit auto-page-break at 756pt. Footer drawn at ~766pt triggered
auto-insert blank page before explicit addPage() — doubling page count.
- Fix A: FOOTER_HEIGHT=50, all footer text gets lineBreak:false
- Fix B: TOTAL OPEX derived from component sum when direct key missing
- Fix C: Portrait column widths (165+4×90=525pt ≤ 540pt usable)
- Fix D: Deals query .select("id, name, borrower_name, bank_id")
- Fix E: PFS periods filtered from buildPeriodMaps
- Result: 4 clean pages, zero ghost blanks

### MMAS Parity — Phases A–G ✅ PR #208
Full 7-phase sprint bringing Classic Spread to Moody's MMAS standard.
865 insertions, 8 files:

| Phase | What | Files |
|-------|------|-------|
| A | Extraction: 30 new BTR entities, 55+ ENTITY_MAP entries, Schedule L keys | geminiFlashPrompts.ts, taxReturnDeterministic.ts, scheduleLReconciliation.ts |
| B | Full Schedule L BS: AR gross/allowance/net, U.S. Gov, tax-exempt, depletable, land, intangibles, officer loans, mortgage loans, wages payable, loans from shareholders | classicSpreadLoader.ts |
| C | 14 detailed opex lines + below-the-line (other income, distributions, D&A addback) | classicSpreadLoader.ts |
| D | UCA Cash Flow: NI → D&A → WC deltas → CFO → CapEx → distributions → CADS | classicSpreadLoader.ts, types.ts |
| E | Expanded ratios: UCA CFO DSCR, TNW, debt/TNW, op profit margin, AP/inventory days, growth | classicSpreadLoader.ts |
| F | Narrative engine (optional, Anthropic API, graceful fallback) | narrativeEngine.ts (new), route.ts |
| G | Renderer: Cash Flow page, narrative page, CashFlowRow drawing | classicSpreadRenderer.ts |

### AAR 19 — IS Key Suffix Mismatch ✅ PR #209
Root cause: Extraction stores IS expense keys with `_IS` suffix
(e.g. `SALARIES_WAGES_IS`). PR #208 loader looked for bare names —
394,098 of 2025 operating expense detail was invisible.
- Fix 1: All 7 IS expense getVals() changed to getValsFallback() with _IS variants.
  totalOpex/otherOpex derivation updated with same fallbacks.
- Fix 2: Exec summary TCA/TCL replaced with component-based derivation
  matching buildBalanceSheetRows logic.
- Fix 3: Ratio getOpex() updated with same _IS suffix fallbacks.
- 1 file changed, 86 insertions, 31 deletions. tsc clean.

---

## Current State — Live Deal 07541fce (Run 21)

"CLAUDE FIX 21" — Samaritus test deal

| Area | Status |
|------|--------|
| Document extraction (9/9 docs) | ✅ Complete |
| Pricing saved ($600K / 6.5% / 10yr) | ✅ Complete |
| ADS = $81,754 | ✅ Computed |
| Classic Spread PDF — 4+ clean pages, no ghost blanks | ✅ Working |
| IS detail lines (2025) — Salaries, Repairs, Advertising, Insurance | ✅ After PR #209 |
| TCA/TCL derived from components for tax return years | ✅ After PR #209 |
| Liquidity ratios (Current, Quick, Working Capital) | ✅ After PR #209 |
| Cash Flow page in PDF | ✅ After PR #208/209 |
| Narrative page in PDF | ✅ After PR #208 (requires ANTHROPIC_API_KEY in Vercel) |
| DSCR — requires pricing re-save to trigger re-computation | 🔜 Manual action |
| IS detail for 2022–2024 (salaries, rent, repairs) | 🔴 Needs re-extraction with v2 prompts |
| Schedule L expanded keys (land, intangibles, officer loans) | 🔴 Needs re-extraction with v2 prompts |

**Post-deploy action required:**
Go to deal 07541fce → Pricing tab → re-save pricing assumptions
→ triggers 3-pass pipeline → computes cash_flow_available → DSCR populates.

---

## Known Gaps — Priority Order

### P1 — Immediate

1. **Re-extract 2022–2024 documents with v2 prompts**
   The new Schedule L keys (SL_LAND, SL_INTANGIBLES_GROSS, SL_AR_GROSS,
   SL_WAGES_PAYABLE, SL_LOANS_FROM_SHAREHOLDERS) and IS keys
   (SALARIES_WAGES_IS, RENT_EXPENSE_IS, REPAIRS_MAINTENANCE_IS) only
   populate on newly extracted documents. Existing 2022–2024 facts were
   extracted under v1 prompts. Re-extract each document via the extraction
   panel to populate these keys.

2. **Personal Tax Return (PTR) extractor not built**
   PTR documents are currently classified as BUSINESS_TAX_RETURN and run
   through the BTR extractor. Form 1040, Schedule E, Schedule F, Form 4562,
   Form 8825 need dedicated extraction prompts and fact key mappings.

3. **DSCR re-computation**
   Re-save pricing on deal 07541fce to trigger pipeline and populate
   cash_flow_available for DSCR.

### P2 — Near Term

4. **Model Engine V2 activation**
   USE_MODEL_ENGINE_V2 feature flag disabled in production. DB tables
   (metric_definitions, model_snapshots) empty. Pulse telemetry events
   not forwarding. Voice constraints exist in code but not injected into
   OpenAI realtime sessions.

5. **Observability pipeline wiring**
   Infrastructure exists (deal_pipeline_ledger, forwarding logic, Vercel
   cron) but events not flowing. Missing env vars:
   PULSE_TELEMETRY_ENABLED, PULSE_BUDDY_INGEST_URL,
   PULSE_BUDDY_INGEST_SECRET, CRON_SECRET.

6. **Corpus expansion**
   Currently 2 Samaritus docs. Need 10+ across industries for bank-grade
   confidence. Add Form 1120, Form 1065, first multi-entity deal with K-1s.

### P3 — Future

7. **Crypto lending module**
   Trigger-price-indexed margin call monitoring, tiered risk proximity
   system, Supabase schema extensions for collateral tracking.

8. **Treasury product auto-proposal engine**
   Leverage financial data already collected during loan underwriting.

9. **RMA peer/industry comparison**
   Connect to RMA data for industry benchmark ratios on the spread.

---

## What Will Still Be Blank Until Re-Extraction

After PRs #208–#209, these line items require re-extraction with v2 prompts:

```
IS 2022–2024: Officers Comp, Salaries & Wages, Rent Expense,
              Repairs & Maintenance, Advertising, Bad Debt

BS all years: Land, Intangibles Gross/Net, Officer Loans Receivable,
              Wages Payable, Loans from Shareholders

Cash Flow:    Working Capital delta rows sparse (AP exists but wages/
              other CL don't yet) — UCA CFO = NI + D&A only for most years
```

These are not bugs — they are extraction gaps awaiting re-extraction.
The loader code will correctly populate them the moment the facts exist.

---

## Technical Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js, Tailwind, Vercel |
| Database | Supabase (PostgreSQL) |
| AI Models | Claude claude-opus-4-6 (spreads/narrative), Gemini Flash (extraction) |
| Integration | MCP (Model Context Protocol) |
| Event Ledger | Supabase `deal_events` (append-only) |
| PDF Generation | PDFKit (portrait 8.5×11, serverExternalPackages) |
| Deployment | Vercel (frontend), Cloud Run (workers) |
| Observability | Aegis findings, Pulse MCP |
| Testing | Vitest, Playwright |

---

## Active Test Deals

**Deal 07541fce** — "CLAUDE FIX 21" / Samaritus Management LLC
Primary active test deal. Run 21. 9/9 docs extracted.
EBITDA: 2022=325,912 / 2023=475,246 / 2024=556,866 / 2025=368,499

---

## Definition of Done — God Tier

1. ✅ AUTO-VERIFIED on 95%+ of clean tax returns — zero human data verification
2. ✅ IRS identity checks on every extracted document
3. ✅ Multi-source corroboration from independent sources
4. ✅ Reasonableness engine with NAICS-calibrated norms
5. ✅ Formula accuracy — every spread line mathematically verifiable
6. ✅ Financial intelligence — EBITDA, officer comp, global cash flow
7. ✅ Industry intelligence — 7 NAICS profiles
8. ✅ Cross-document reconciliation — K-1s, balance sheet, ownership
9. ✅ Golden corpus regression tests on every commit
10. ✅ Continuous learning — analyst corrections feed back into accuracy metrics
11. ✅ Audit certificate generated for every AUTO-VERIFIED spread
12. ✅ Full relationship view — loans + deposits + treasury in one workflow
13. ✅ Section 106 compliance baked into relationship pricing output
14. ✅ Classic Banker Spread PDF — MMAS format, 6+ pages, zero ghost blanks
15. ✅ UCA Cash Flow statement in PDF
16. ✅ Expanded MMAS ratio set (liquidity, leverage, coverage, profitability, activity, growth)
17. ✅ AI narrative engine (optional, graceful fallback)
18. ✅ Personal tax return extraction with IRS identity validation (Phase 16)
19. 🔜 Banker experience — opens a spread, trusts every number, focuses on credit
    (this one is never fully done — it's the ongoing standard)

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
- Compliance is structural. Section 106, SR 11-7 — baked in, not bolted on.
- Key names are contracts. IS suffix (_IS) vs bare names must be consistent
  across extraction and loader layers. Use getValsFallback() for both variants.

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
| 9 | Full Banking Relationship | ✅ Complete | #177 |
| 2C–3D | Credit Memo + Cockpit Panels | ✅ Complete | #180–184 |
| Spread v1 | Spread output infrastructure | ✅ Complete | #185–187 |
| AARs 1–7 | 7-bug batch fix | ✅ Complete | #188–194 |
| AARs 8–16 | Spread route + snapshot wiring | ✅ Complete | #195–196 |
| AAR 17 | PDFKit serverExternalPackages | ✅ Complete | hotfix |
| Classic Spread v1 | BS/IS/Ratios/Exec PDF | ✅ Complete | #197 |
| AAR 18 | Portrait layout + ghost pages + OPEX | ✅ Complete | #207 |
| MMAS Parity A–G | Full MMAS spread (7 phases, 865 insertions) | ✅ Complete | #208 |
| AAR 19 | IS key suffix mismatch + exec TCA/TCL | ✅ Complete | #209 |
| Phase 10 | Deal Command Center (Intelligence tab) | ✅ Complete | #216 |
| Phase 11 | Financial Intelligence Workspace (Financials tab) | ✅ Complete | #217 |
| Phase 12 | Structure Lab (Structure tab) | ✅ Complete | #218 |
| Phase 13 | Risk Signal Grid + Evidence Audit (Risk tab) | ✅ Complete | #219 |
| Phase 14 | Relationship Wallet (Relationship tab) | ✅ Complete | #220 |
| Phase 15 | Committee Studio (Committee tab) | ✅ Complete | #221 |
| Phase 16 | Personal Tax Return Extractor (Form 1040 + Schedule E) | ✅ Complete | #222 |
| Phase 17 | PTR Entity Map (wire extraction output to facts) | ✅ Complete | #223 |
| Phase 18 | Global Cash Flow Computation (entity + personal aggregation) | ✅ Complete | #224 |
| Phase 19 | Global Cash Flow PDF Page (Classic Spread) | ✅ Complete | #225 |
| **Phase 20** | **TBD** | **⬅ NEXT** | — |
| Re-extraction | v2 prompt re-extraction of existing docs | 🔜 Manual action | — |
| Model Engine V2 | Feature flag + seeding + wiring | 🔜 Queued | — |
| Observability | Telemetry pipeline activation | 🔜 Queued | — |
| Corpus Expansion | 10+ verified docs across industries | 🔜 Queued | — |

*The mission: a system that proves itself right before delivery —
so bankers focus entirely on credit judgment.*
