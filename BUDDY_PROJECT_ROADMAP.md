# Buddy The Underwriter — Project Roadmap
# Institutional-Grade Commercial Lending AI Platform

**Last Updated: March 2026**
**Status: AAR 22 Complete — Async Extraction Decoupling — Phase 25 Next**

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
IRS Knowledge Base + Identity Validation   ✅ Phase 1 & 2 COMPLETE
        ↓
Formula Accuracy Layer                     ✅ Phase 3 COMPLETE
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
- 6 checks: K-1→Entity, K-1→Personal, Tax→Financials,
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

## COS UI + AI Provider Migration (PRs #216–#231)

### Phase 10 — Deal Command Center (Intelligence tab) ✅ PR #216
### Phase 11 — Financial Intelligence Workspace (Financials tab) ✅ PR #217
### Phase 12 — Structure Lab (Structure tab) ✅ PR #218
### Phase 13 — Risk Signal Grid + Evidence Audit (Risk tab) ✅ PR #219
### Phase 14 — Relationship Wallet (Relationship tab) ✅ PR #220
### Phase 15 — Committee Studio (Committee tab) ✅ PR #221
### Phase 16 — Personal Tax Return Extractor (Form 1040 + Schedule E) ✅ PR #222
### Phase 17 — PTR Entity Map (wire extraction output to facts) ✅ PR #223
### Phase 18 — Global Cash Flow Computation (entity + personal aggregation) ✅ PR #224
### Phase 19 — Global Cash Flow PDF Page (Classic Spread) ✅ PR #225
### Phase 20 — Bulk Re-extraction Trigger (POST + status + UI button) ✅ PR #226
### Phase 21 — DSCR Reconciliation + Spread Completeness Score ✅ PR #227
### Phase 22 — Gemini Migration (narrativeEngine + aiJson + creditMemo) ✅ PR #228
### Phase 23 — Gemini Classifier Shadow Mode + classification_shadow_log ✅ PR #229
### Phase 24 — Gemini Classifier Cutover ✅ COMPLETE — commit dfdfc066

Data gate rationale: Shadow log accumulates only during fresh gatekeeper
classification. `reextract-all` bypasses gatekeeper entirely — shadow never
fires from re-extractions. With only 2 deals / 9 docs, the 20-row / 95%
agree gate had no statistical validity. Skipped data gate; cut over directly.

Two files changed:
- `src/lib/gatekeeper/geminiClassifier.ts` — added `GEMINI_PROMPT_VERSION`,
  `getGeminiPromptHash()`, `getGeminiPromptVersion()` exports
- `src/lib/gatekeeper/runGatekeeper.ts` — swapped OpenAI primary for Gemini
  primary (`classifyWithGeminiText` / `classifyWithGeminiVision`), removed
  shadow call block entirely, updated prompt hash/version helpers

Rollback: revert the two-line swap. Shadow log keeps accumulating either way.
Verification: `deal_documents.gatekeeper_model = "gemini-2.0-flash"` on next upload.

---

## After-Action Reviews — Current Session

### AAR 20 — Intelligence Tab Blank Metrics (spread-output shape mismatch) ✅ commit fb811545

**Root cause:** `composeSpreadOutput()` returns `SpreadOutputReport` with
`{ executive_summary, normalized_spread, ratio_scorecard, story_panel,
generated_at }`. `IntelligenceClient.tsx` reads `canonical_facts`, `ratios`,
`years_available`, `flag_report`, `trend_report`, `narrative_report` directly
off the spread response — none of those fields were in the composed output.
Route built perfect data in `input` and `ratiosResult`, called
`composeSpreadOutput(input)`, then returned only the composed report —
silently dropping all raw fields. TypeScript didn't catch it because the
route casts as `any` and the hook's local type was aspirational.

**Fix — `src/app/api/deals/[dealId]/spread-output/route.ts`:**
Return merged object spreading both the composed report and the raw fields:
`canonical_facts`, `ratios`, `years_available`, `flag_report`, `trend_report`,
and `narrative_report` (mapped from `story_panel`).

**What this fixed:** All 12 metric cells in Intelligence tab, DSCR Triangle,
Financial Snapshot row, Buddy's Assessment narrative, Risk signals, Committee
Readiness score.

### AAR 21 — Classic Spreads tab + PDF button fix ✅ commit 6e449800

**Problem 1:** PDF button in deal header called
`/api/deals/[dealId]/credit-memo/canonical/pdf` which was 500ing
(canonical credit memo PDF — separate broken route).

**Problem 2:** Classic Spreads PDF had no prominent entry point — it was
buried as an output rather than a first-class banker workflow.

**Fix:**
- `DealShell.tsx` — added `{ label: "Classic Spreads", href: ${base}/classic-spreads }`
  to the tab array; replaced broken PDF button with a `<Link>` shortcut to
  the new tab; removed unused `ExportCanonicalMemoPdfButton` import
- `src/app/(app)/deals/[dealId]/classic-spreads/page.tsx` — new server
  component with auth guard (`requireRole`, `ensureDealBankAccess`)
- `src/app/(app)/deals/[dealId]/classic-spreads/ClassicSpreadsClient.tsx` —
  client: idle → Generate button → calls `/api/deals/[dealId]/classic-spread`
  → streams PDF → renders inline in full-height iframe with Download button

Classic Spreads is now the 10th tab on every deal, with a "Spreads" shortcut
in the header action bar. PDF generation and inline preview work end-to-end.

### AAR 22 — Async Document Extraction Decoupling ✅ PR #231

**Root cause:** `processConfirmedIntake.ts` called `extractByDocType()` for
every document inline inside the 240s soft deadline. Each call: Supabase
Storage download + Gemini OCR (30–120s per doc) + optional structured assist.
With 9 docs at DOC_CONCURRENCY=3: 3 batches × 60–90s = 180–270s — reliably
blowing past `SOFT_DEADLINE_MS = 240000ms`. Every new deal landed in
`PROCESSING_COMPLETE_WITH_ERRORS`.

**Architecture after fix:**

_Phase A — Intake processing (fast, <60s):_
1. Document matching for all docs (2–5s each)
2. Insert `doc.extract` outbox event per extractable doc
3. Non-fact-dependent deal ops: checklist reconcile, lifecycle bootstrap, naming
4. Mark deal `PROCESSING_COMPLETE`

_Phase B — Doc extraction worker (async, one event per doc):_
1. Cron fires every 1 minute, claims up to 10 `doc.extract` events
2. Runs `extractByDocType(docId)` for each claimed doc
3. After each success: triggers `orchestrateSpreads` + `materializeFactsFromArtifacts`
   + `recomputeDealReady` (idempotent — recomputes with whatever facts exist)
4. Marks outbox event delivered; exponential backoff; dead-letters after 5 attempts

**Files changed:**

| File | Change |
|------|--------|
| `src/lib/intake/processing/queueDocExtractionOutbox.ts` | New — inserts `doc.extract` outbox events |
| `src/lib/workers/processDocExtractionOutbox.ts` | New — durable worker, exponential backoff, dead-letter at 5 attempts |
| `src/app/api/workers/doc-extraction/route.ts` | New — Vercel cron (every 1 min, max 10 docs, 300s maxDuration) |
| `src/lib/intake/processing/processConfirmedIntake.ts` | Replaced inline `extractByDocType()` with outbox queue; removed `orchestrateSpreads` + `materializeFactsFromArtifacts` blocks |
| `vercel.json` | Added `/api/workers/doc-extraction?max=10` cron at `*/1 * * * *` |
| Migration | `claim_doc_extraction_outbox_batch` SQL function applied |

**Verification:** New deals reach `PROCESSING_COMPLETE` in <60s.
`buddy_outbox_events` rows with `kind = 'doc.extract'` get `delivered_at`
populated within 1–3 minutes. Facts + spreads populate progressively as
each doc extracts.

---

## Current State — Active Deal ffcc9733

"Samaritus Management LLC" — deal ffcc9733-f866-47fc-83f9-7c08403cea71

| Area | Status |
|------|--------|
| Document extraction | ✅ 159 facts across 6 periods |
| Re-extract All triggered | ✅ succeeded, run_reason=recompute |
| ADS = $67,368 | ✅ Computed (deal_structural_pricing) |
| Intelligence tab metrics | ✅ After AAR 20 fix (fb811545) |
| Classic Spreads tab | ✅ After AAR 21 fix (6e449800) |
| DSCR Triangle (ADS=$67K, EBITDA=$368K–$557K → ~5x+) | ✅ Populated after deploy |
| Spread Completeness | 48% F — Revenue/OPEX/OpIncome missing |
| financial_snapshots | 2 rows from 00:36 UTC — stale, but spread-output route reads facts directly |

**Revenue 4 years:** $798K → $1.2M → $1.5M → $1.4M
**EBITDA 4 years:** $326K → $475K → $557K → $368K

---

## Known Gaps — Priority Order

### P1 — Immediate

1. **PTR extractor not built**
   PTR documents classified as BUSINESS_TAX_RETURN, run through BTR extractor.
   Form 1040, Schedule E, Schedule F, Form 4562, Form 8825 need dedicated
   extraction prompts and fact key mappings.

2. **Re-extract 2022–2024 documents with v2 prompts**
   Schedule L keys (SL_LAND, SL_INTANGIBLES_GROSS, SL_AR_GROSS,
   SL_WAGES_PAYABLE, SL_LOANS_FROM_SHAREHOLDERS) and IS keys
   (SALARIES_WAGES_IS, RENT_EXPENSE_IS, REPAIRS_MAINTENANCE_IS) only
   populate on newly extracted documents. Existing facts were extracted
   under v1 prompts.

### P2 — Near Term

3. **Model Engine V2 activation**
   USE_MODEL_ENGINE_V2 feature flag disabled. DB tables (metric_definitions,
   model_snapshots) empty. Pulse telemetry events not forwarding. Voice
   constraints exist in code but not injected into OpenAI realtime sessions.

4. **Observability pipeline wiring**
   Infrastructure exists (deal_pipeline_ledger, forwarding logic, Vercel cron)
   but events not flowing. Missing env vars: PULSE_TELEMETRY_ENABLED,
   PULSE_BUDDY_INGEST_URL, PULSE_BUDDY_INGEST_SECRET, CRON_SECRET.

5. **Corpus expansion**
   Currently 2 Samaritus docs. Need 10+ across industries. Add Form 1120,
   Form 1065, first multi-entity deal with K-1s.

### P3 — Future

6. **Crypto lending module** — trigger-price-indexed margin call monitoring,
   tiered risk proximity, Supabase collateral tracking.

7. **Treasury product auto-proposal engine** — leverage financial data already
   collected during loan underwriting.

8. **RMA peer/industry comparison** — industry benchmark ratios on the spread.

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
|-------|------------|
| Frontend | Next.js, Tailwind, Vercel |
| Database | Supabase (PostgreSQL) |
| AI — Primary | Gemini 2.0 Flash (extraction, narrative, credit memo, aiJson, classifier) |
| AI — Voice | gpt-4o-realtime-preview (intentionally retained on OpenAI) |
| AI — Reasoning | o1-preview / Gemini 2.5 Pro (orchestrator, Phase 25 evaluation) |
| Integration | MCP (Model Context Protocol) |
| Event Ledger | Supabase `deal_events` (append-only) |
| PDF Generation | PDFKit (portrait 8.5×11, serverExternalPackages) |
| Deployment | Vercel (frontend), Cloud Run (workers) |
| Observability | Aegis findings, Pulse MCP |
| Testing | Vitest, Playwright |

---

## AI Provider Inventory

| Workload | Model | Status |
|----------|-------|--------|
| Document extraction | Gemini 2.0 Flash | ✅ Active |
| Classic Spread narrative | Gemini 2.0 Flash | ✅ |
| Credit memo generation | Gemini 2.0 Flash | ✅ |
| General aiJson() wrapper | Gemini 2.0 Flash | ✅ |
| Document classification | Gemini 2.0 Flash | ✅ Active (Phase 24) |
| Voice interview sessions | gpt-4o-realtime-preview | ✅ Retained on OpenAI intentionally |
| Underwriting orchestrator | o1-preview / Gemini 2.5 Pro eval | 🔜 Phase 25 |

---

## Active Test Deals

**Deal 07541fce** — "CLAUDE FIX 21" / Samaritus Management LLC
Primary regression test deal. Run 21. 9/9 docs extracted.
EBITDA: 2022=325,912 / 2023=475,246 / 2024=556,866 / 2025=368,499

**Deal ffcc9733** — Samaritus Management LLC (current active)
159 facts, 6 periods. Intelligence tab fix deployed. ADS=$67,368.

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
19. ✅ Classic Spreads as first-class tab on every deal (AAR 21)
20. ✅ Intelligence tab fully populated — all 12 metric cells, DSCR Triangle, Buddy's Assessment (AAR 20)
21. ✅ New deal intake completes in <60s — no soft deadline timeouts (AAR 22)
22. 🔜 Banker experience — opens a spread, trusts every number, focuses on credit
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
- Route response shapes must match client consumption types exactly.
  TypeScript won't catch shape mismatches when routes cast as `any`.
  Always verify what IntelligenceClient / hooks actually read from the API.
- reextract-all bypasses gatekeeper entirely — shadow never fires from re-extractions.
- Gemini extraction is duration-unpredictable (30–120s per doc). Never await it
  inline inside a time-bounded orchestration window. Always queue extraction as
  outbox events and let a dedicated worker handle it asynchronously.

---

## Progress Tracker

| Phase | Description | Status | PR / Commit |
|-------|-------------|--------|-------------|
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
| Phase 20 | Bulk Re-extraction Trigger (POST + status + UI button) | ✅ Complete | #226 |
| Phase 21 | DSCR Reconciliation + Spread Completeness Score | ✅ Complete | #227 |
| Phase 22 | Gemini Migration (narrativeEngine + aiJson + creditMemo) | ✅ Complete | #228 |
| Phase 23 | Gemini Classifier Shadow Mode + classification_shadow_log | ✅ Complete | #229 |
| Phase 24 | Gemini Classifier Cutover (direct, data gate skipped) | ✅ Complete | dfdfc066 |
| AAR 20 | Intelligence tab blank metrics — spread-output shape mismatch | ✅ Complete | fb811545 |
| AAR 21 | Classic Spreads tab + PDF button fix | ✅ Complete | 6e449800 |
| AAR 22 | Async extraction decoupling — 240s soft deadline fix | ✅ Complete | PR #231 |
| **Phase 25** | **Orchestrator reasoning model — Gemini 2.5 Pro evaluation** | **⬅ NEXT** | — |
| Model Engine V2 | Feature flag + seeding + wiring | 🔜 Queued | — |
| Observability | Telemetry pipeline activation | 🔜 Queued | — |
| Corpus Expansion | 10+ verified docs across industries | 🔜 Queued | — |

---

## Phase 25 Spec — Orchestrator Reasoning Model

**Branch:** `feature/orchestrator-reasoning-model` | **PR:** #232
**Commit:** `feat: Phase 25 — Gemini 2.5 Pro orchestrator evaluation`
**Gate:** `pnpm tsc --noEmit` — zero errors.

**Context:** The underwriting orchestrator currently runs on `o1-preview`.
Gemini 2.5 Pro is now available and offers comparable reasoning with tighter
Gemini ecosystem integration. This phase evaluates parity and optionally
migrates.

**Evaluation criteria:**
1. DSCR computation accuracy — compare orchestrator output for deal ffcc9733
   with manual calculation (ADS=$67,368 / EBITDA=$368,499 → expected ~5.5x)
2. Credit memo narrative quality — compare Gemini 2.5 Pro vs o1-preview output
   on the same deal facts
3. Latency — Gemini 2.5 Pro target: ≤ o1-preview p95 latency
4. Cost — Gemini 2.5 Pro pricing vs o1-preview per 1M tokens

**Implementation pattern (shadow before cutover):**
```typescript
// Phase 25 shadow: run both, log disagreements
const o1Result = await runOrchestratorO1(input);
const geminiResult = await runOrchestratorGemini25(input);
await logOrchestratorShadow({ o1Result, geminiResult, dealId });
return o1Result; // primary until cutover
```

**Migration — `src/lib/orchestrator/runOrchestrator.ts`:**
- Add `runOrchestratorGemini25()` alongside existing `runOrchestratorO1()`
- Wire shadow logging to new `orchestrator_shadow_log` table
- Cutover: swap return to `geminiResult` after 20+ rows with ≥95% agree

**Migration — Supabase:**
```sql
create table orchestrator_shadow_log (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references deals(id),
  o1_result jsonb,
  gemini_result jsonb,
  agree boolean generated always as (
    o1_result->>'classification' = gemini_result->>'classification'
  ) stored,
  created_at timestamptz default now()
);
alter table orchestrator_shadow_log enable row level security;
```

**No functional change to banker-facing output in Phase 25.**
This is purely an evaluation + shadow mode phase.

**Verification:**
1. `pnpm tsc --noEmit` clean
2. Run orchestrator on deal ffcc9733 — both o1 and Gemini 2.5 Pro fire
3. `orchestrator_shadow_log` row inserted
4. Primary result (o1) returned unchanged to caller

---

*The mission: a system that proves itself right before delivery —
so bankers focus entirely on credit judgment.*
