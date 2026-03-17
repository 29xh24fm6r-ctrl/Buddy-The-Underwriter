# Buddy The Underwriter — Project Roadmap
# Institutional-Grade Commercial Lending AI Platform

**Last Updated: March 2026**
**Status: Phase 33 complete — Institutional-grade credit memo (Florida Armory standard)**

---

## Vision

Buddy is a commercial lending AI platform that processes financial documents,
performs underwriting analysis, and generates risk assessments for banks.

The north star: **every number that reaches a credit committee must be
correct, traceable, and defensible under audit — without requiring a human
to manually verify the math.**

**The goal: a banker opens a spread and focuses entirely on credit judgment.
They never wonder if the numbers are right. They already know they are.**

---

## The Accuracy Philosophy — Two Distinct Problems

**Problem 1 — Data accuracy verification.** TECHNICAL problem. Solvable with rigor.
**Problem 2 — Credit decision authority.** JUDGMENT problem. OCC SR 11-7 and FDIC
guidance require human oversight. Non-negotiable.

---

## Core Architecture

### The Intelligence Stack

```
Documents (tax returns, financials, statements)
        ↓ Document Classification + OCR
        ↓ Structured Extraction Engine (Gemini Flash)
        ↓ IRS Knowledge Base + Identity Validation   ✅ Phase 1 & 2
        ↓ Formula Accuracy Layer                     ✅ Phase 3
        ↓ Proof-of-Correctness Engine               ✅ Phase 4
        ↓ Financial Intelligence Layer               ✅ Phase 5
        ↓ Industry Intelligence Layer               ✅ Phase 6
        ↓ Cross-Document Reconciliation             ✅ Phase 7
        ↓ Golden Corpus + Continuous Learning       ✅ Phase 8
        ↓ Full Banking Relationship                 ✅ Phase 9
        ↓ Classic Banker Spread PDF (MMAS format)   ✅ PRs #180–#209
        ↓ AUTO-VERIFIED → Banker reviews for credit judgment only
        ↓ AI Risk Assessment (Gemini 3 Flash)       ✅ BB+ LIVE
        ↓ Institutional Research Engine (BRE)       ✅ Phase 31
        ↓ Credit Memo (Florida Armory standard)     ✅ Phase 33
        ↓ Committee Package
        ↓ Deposit Profile + Treasury Proposals surfaced automatically
```

---

## The Proof-of-Correctness System — All Gates Live

**Gate 1–4 + Cross-Document Reconciliation + Golden Corpus** ✅ Phases 1–8

---

## Completed Phases — Foundation through COS UI Migration

### PHASE 1–9 ✅ COMPLETE — PRs #169–#177
### Classic Banker Spread Sprint ✅ COMPLETE — PRs #180–#209
### Phases 10–24 ✅ COMPLETE — PRs #216–#229, commit dfdfc066

---

## After-Action Reviews — Current Session

### AAR 20–22b ✅ — fb811545, 6e449800, PR #231, PR #232
### Phase 25–29 ✅ — PR #233, bbee0903, 712961c5
### AAR 23–24 ✅ — `document_extracts` persistence, OpenAI schema wrapping
### Gemini 3 Flash Orchestrator Cutover ✅ — ORCHESTRATOR_USE_GEMINI3_FLASH=true
### AAR 25–34 ✅ — Full Gemini structured output chain + AI Risk Assessment LIVE (BB+, 975 bps)
### Phase 31 ✅ — Research Engine activated + Credit Memo gated on research
### AAR 35 ✅ — Canonical memo error visible + RunResearchButton component
### AAR 36 ✅ — `deals.loan_amount` fix + sequential borrower query in research route

---

## Phase 32 — Snapshot Bridge: Structural Pricing → Facts → Snapshot ✅ COMPLETE

**Root cause of all "Pending" metrics on canonical memo:**
DSCR, ADS, CFA, and Excess CF were computed live in `spread-intelligence/route.ts`
from `deal_structural_pricing` but never persisted to `deal_financial_facts`. The
snapshot engine (`buildDealFinancialSnapshotForBank`) reads only from facts — so
DSCR was null in every snapshot across the entire platform (confirmed: 0 rows with
DSCR populated in `financial_snapshots`).

**Fix — `src/app/api/deals/[dealId]/spread-intelligence/route.ts`:**
After computing DSCR and ADS from the reconciliation triangle and `deal_structural_pricing`,
write back to `deal_financial_facts` as FINANCIAL_ANALYSIS facts:
- `ANNUAL_DEBT_SERVICE` — from `deal_structural_pricing.annual_debt_service_est`
- `DSCR` — from reconciliation triangle (global → entity → uca priority)
- `CASH_FLOW_AVAILABLE` — from `entityCashFlowAvailable`
- `EXCESS_CASH_FLOW` — CFA - ADS

Then immediately rebuild and persist the snapshot via `buildDealFinancialSnapshotForBank`
+ `persistFinancialSnapshot`. Non-fatal — wrapped in try/catch, never blocks response.

**Trigger:** Hitting "Regenerate" on Classic Spreads calls `spread-intelligence/GET`,
which now bridges the computed metrics through to the snapshot and credit memo.

---

## Phase 33 — Institutional-Grade Credit Memo (Florida Armory Standard) ✅ COMPLETE

**Reference standard:** Florida Armory LLC SBA 7(a) write-up — 18-page institutional
credit memo used as the exact layout and content target.

**What shipped (commit b1233493):**

**FILE 1 — `src/lib/creditMemo/canonical/types.ts`:**
Expanded `CanonicalCreditMemoV1` with 6 new row types and ~10 new top-level sections:
- `DebtCoverageRow` — multi-period debt coverage table (Interim/Year 1/Year 2)
- `IncomeStatementRow` — multi-period P&L with % columns
- `RatioAnalysisRow` — ratios vs IBISWorld 10yr averages
- `CollateralLineItem` — itemized collateral with advance rates and lien positions
- `GlobalCFRow` — combined business + personal CF by period
- `GuarantorBudget` — per-guarantor PFS assets/liabilities + monthly budget analysis
New sections: `eligibility`, `business_summary`, `management_qualifications`,
`personal_financial_statements`, `strengths_weaknesses`, extended `collateral`
(line_items, life_insurance), extended `header` (guarantors, lender_name, action_type,
sba_sop), extended `key_metrics` (rate details, monthly_payment, guaranty_pct),
extended `financial_analysis` (debt_coverage_table, income_statement_table,
ratio_analysis, breakeven), extended `global_cash_flow` (global_cf_table),
extended `conditions` (insurance[]), extended `recommendation` (exceptions[]).

**FILE 2 — `src/lib/creditMemo/canonical/buildCanonicalCreditMemo.ts`:**
Parallel DB queries for borrower, ownership entities, AI risk run, structural pricing,
and multi-period facts. Builds debt_coverage_table, income_statement_table,
strengths_weaknesses (from AI risk factors + computed metrics), eligibility (from
NAICS), management_qualifications (from ownership_entities), personal_financial_statements
(from sponsor bindings), collateral line items, rate fields, and insurance conditions.

**FILE 3 — `src/components/creditMemo/CanonicalMemoTemplate.tsx`:**
Full institutional layout matching Florida Armory format exactly: 15+ sections,
inline table helper components, pivot tables for debt coverage / income statement /
global CF, PFS per-guarantor layout, approval signature block, gray-italic "Pending"
placeholders. Typography: `text-sm` body, `text-xs` tables, right-aligned numbers,
`bg-gray-100` section headers.

**Sections now rendered:**
1. Readiness bar + data coverage
2. Header box (bank, date, borrower, action type)
3. Financing Request box (loan #, amount, rate, term, SBA program, monthly payment, guaranty %)
4. Deal Summary / Purpose
5. Sources & Uses table (Use | Bank Loan | Equity | Total)
6. Collateral Analysis table (itemized, advance rates, lien positions, discounted coverage)
7. Eligibility (NAICS, SBA size standard, historical NAICS SBA stats when available)
8. Business & Industry Analysis (from BRE research)
9. Management Qualifications (principals table + bio)
10. Financial Analysis — Debt Coverage Table (multi-period, stressed DSCR)
11. New Debt table
12. Global Cash Flow table (combined business + personal, multi-period)
13. Income Statement table (multi-period, % columns, IBISWorld benchmarks)
14. Repayment ability + projection feasibility + breakeven
15. Personal Financial Statement per guarantor (assets/liabilities + monthly budget)
16. Strengths & Weaknesses
17. Policy Exceptions
18. Proposed Terms
19. Conditions (precedent, ongoing, insurance)
20. Recommendation + Approval signature block

---

## Current State — Active Deals

**Deal ffcc9733** — Samaritus Management LLC (primary active)
`borrower_id = null`, `loan_amount = null` — foundational data gaps.
9/9 docs extracted. Revenue: $1.36M (latest). ADS=$67,368 (structural pricing).
✅ AI Risk Assessment LIVE: BB+ grade, 975 bps
✅ Snapshot bridge: DSCR/ADS will populate after "Regenerate" on Classic Spreads

**Immediate sequence:**
1. Classic Spreads → Regenerate (triggers Phase 32 bridge → DSCR/ADS into facts → snapshot)
2. Credit Memo → Run Research (first live BRE mission)
3. Credit Memo → Generate Narratives (Gemini 3 Flash with research context)
4. Review Phase 33 institutional memo layout

**Remaining blockers for Committee Approve:**
- `borrower_id = null` — links deal to borrower for NAICS, eligibility section
- `loan_amount = null` on deal record — needed for LTV, equity %, financing request box
- Reconciliation CLEAN/FLAGS ❌
- Extraction confidence ≥ 85% ❌

---

## Known Gaps — Priority Order

### P1 — Immediate

1. **✅ AI Risk Assessment** — BB+ grade live
2. **✅ Phase 32** — Snapshot bridge deployed
3. **✅ Phase 33** — Institutional memo layout deployed
4. **Classic Spreads → Regenerate** — activates Phase 32 bridge for ffcc9733
5. **Link deal to borrower** — set `borrower_id` and `loan_amount` on deal ffcc9733
6. **Run Research** — first live BRE mission
7. **Generate Narratives** — first research-grounded memo
8. **Reconciliation** — `recon_status` NULL. Blocks Committee.

### P2 — Near Term

- **Model Engine V2 activation** — feature flag disabled, DB tables empty
- **Observability pipeline** — missing env vars
- **Corpus expansion** — 2 Samaritus docs. Need 10+ across industries
- **NAICS SBA historical stats** — Lumos data integration for eligibility section
- **Management qualifications** — requires intake interview data capture
- **Projection years** — Year 1/Year 2 rows in debt coverage and income statement tables

### P3 — Future

- chatAboutDeal Gemini migration
- Crypto lending module
- Treasury product auto-proposal engine
- RMA peer/industry comparison

---

## Technical Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js, Tailwind, Vercel |
| Database | Supabase (PostgreSQL) |
| AI — Extraction | Gemini 2.0 Flash via Vertex AI (GOOGLE_CLOUD_PROJECT + GCP ADC) |
| AI — Voice | gpt-4o-realtime-preview (intentionally retained on OpenAI) |
| AI — Reasoning | Gemini 3 Flash via Developer API (GEMINI_API_KEY) — cutover complete |
| Integration | MCP (Model Context Protocol) |
| Event Ledger | Supabase `deal_events` (append-only) |
| PDF Generation | PDFKit (portrait 8.5×11, serverExternalPackages) |
| Deployment | Vercel (frontend), Cloud Run (workers) |
| Testing | Vitest, Playwright |

---

## AI Provider Inventory

| Workload | Model | Auth | Status |
|----------|-------|------|--------|
| Document extraction | Gemini 2.0 Flash | Vertex AI / GCP ADC | ✅ Active |
| Classic Spread narrative | Gemini 2.0 Flash | Vertex AI / GCP ADC | ✅ |
| Document classification | Gemini 2.0 Flash | Vertex AI / GCP ADC | ✅ Active (Phase 24) |
| Voice interview sessions | gpt-4o-realtime-preview | OpenAI API key | ✅ Retained on OpenAI |
| Risk + Memo orchestrator | Gemini 3 Flash | GEMINI_API_KEY (Dev API) | ✅ **LIVE — BB+ on ffcc9733** |
| chatAboutDeal | OpenAI gpt-4o-2024-08-06 | OpenAI API key | 🔴 Gemini migration queued (P3) |

---

## Definition of Done — God Tier

1–32. ✅ All foundation phases and MMAS sprint items complete.
33. ✅ Gemini 3 Flash orchestrator cutover complete
34–42. ✅ Gemini structured output chain (AARs 24–32)
43. ✅ Research-grounded: `responseJsonSchema`, minimal thinking (AAR 33)
44. ✅ AI Risk Assessment LIVE — BB+ grade, 975 bps (AAR 34)
45. ✅ Research Engine activated (Phase 31)
46. ✅ Credit Memo gated on research (Phase 31)
47. ✅ Canonical memo error visible + RunResearchButton (AAR 35)
48. ✅ `deals.loan_amount` fix + sequential borrower query (AAR 36)
49. ✅ **Snapshot bridge: ADS/DSCR → facts → snapshot (Phase 32)**
50. ✅ **Institutional memo layout — Florida Armory standard (Phase 33)**
51. 🔴 Classic Spreads regenerated — activates Phase 32 bridge for ffcc9733
52. 🔴 Deal ffcc9733: `borrower_id` and `loan_amount` set
53. 🔴 Run Research on ffcc9733 — first live mission
54. 🔴 Generate Credit Memo — first research-grounded memo at institutional standard
55. 🔴 Reconciliation complete — Committee Approve signal unlocked
56. 🔴 Spread completeness ≥80%
57. 🔴 Banker experience — opens a spread, trusts every number, focuses on credit

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
- Key names are contracts. IS suffix (_IS) vs bare names must be consistent.
- Route response shapes must match client consumption types exactly.
- reextract-all bypasses gatekeeper entirely — shadow never fires.
- Gemini extraction is duration-unpredictable. Always queue as outbox events.
- Shadow mode for model migrations: gate with shadow flag, flip cutover after
  ≥20 rows at ≥95% agree. **Exception: if primary is broken and gate cannot fill,
  bypass it directly.**
- **`zodToJsonSchema(schema, name)` with string name = `$ref`-wrapped document.
  Always use `{ $refStrategy: "none" }` + strip `$schema` key for OpenAI.**
- **OpenAI strict mode requires `additionalProperties: false` recursively on all
  object nodes. Use `enforceAdditionalProperties()` post-processor.**
- **`document_extracts` persistence is required for fact extraction to work.**
- **Completeness checker label strings must exactly match `classicSpreadLoader` row labels.**
- **DSCR triangle reads from `deal_structural_pricing`, not `deal_financial_facts`.**
- **BTR-only years need TOTAL_OPERATING_EXPENSES and OPERATING_INCOME derived.**
- **Global CF personal income fallback: compute from raw `PERSONAL_INCOME` facts.
  Bootstrap placeholder facts (value ≤ 1000) must never pass `hasMaterializedPI`.**
- **`CURRENT_ASSETS` and `CURRENT_LIABILITIES` are never stored as direct facts.
  Always derive from SL_ balance sheet components.**
- **The Gemini extraction stack (Vertex AI, GCP ADC) and the Gemini 3 Flash
  orchestrator (Developer API, `GEMINI_API_KEY`) are separate Google auth systems.
  Both must be present in Vercel.**
- **Gemini 3 Flash structured output — final working pattern:**
  - `responseMimeType: "application/json"` only — no `responseJsonSchema`, no `responseSchema`
  - Clean `structureHint` string in prompt; `zodToJsonSchema` causes serialization failure
  - `thinkingLevel: "minimal"` is the lowest valid level; `thinkingBudget` is Gemini 2.5-series only
  - Evidence arrays must be `.optional().default([])` in Zod schemas
- **Research must complete before credit memo generation.** A memo without research
  is a formatted summary — not institutional-grade credit analysis.
- **`runMission()` is imported from `"@/lib/research/runMission"` directly — server-only.**
- **Error paths on server-rendered pages must use dark backgrounds with explicitly
  colored text. White text on no background is invisible.**
- **Never use Supabase join syntax `related_table(columns)` without confirming the FK
  relationship is declared in the schema. Use sequential queries as the safe default.**
- **`deals.loan_amount` is the correct column — not `deals.amount`.**
- **DSCR and ADS must be persisted to `deal_financial_facts` after every
  spread-intelligence computation — the snapshot engine reads only from facts.**
- **The canonical credit memo target standard is the Florida Armory SBA 7(a) write-up:
  18 sections, multi-period pivot tables, PFS per guarantor, collateral itemized with
  advance rates, eligibility with NAICS SBA stats, strengths/weaknesses, approval
  signature block.**

---

## Progress Tracker

| Phase | Description | Status | PR / Commit |
|-------|-------------|--------|-------------|
| 1–9 | Foundation phases | ✅ Complete | #169–#177 |
| 2C–3D through AAR 19 | Classic Banker Spread sprint | ✅ Complete | #180–#209 |
| Phase 10–24 | COS UI + AI Provider Migration | ✅ Complete | #216–#229, dfdfc066 |
| AAR 20–22b | Intelligence tab, Classic Spreads, async extraction | ✅ Complete | fb811545, 6e449800, #231, #232 |
| Phase 25–29 | Orchestrator + Personal Income + Intelligence fixes | ✅ Complete | PR #233, bbee0903, 712961c5 |
| AAR 23–27 | Various fixes | ✅ Complete | — |
| AAR 28–32 | Gemini structured output chain | ✅ Complete | — |
| AAR 33–34 | Research-grounded + AI Risk Assessment LIVE | ✅ Complete | — |
| Phase 31 | Research Engine activated + Credit Memo gated | ✅ Complete | — |
| AAR 35 | Canonical memo error visible + RunResearchButton | ✅ Complete | — |
| AAR 36 | `deals.loan_amount` fix + sequential borrower query | ✅ Complete | — |
| **Phase 32** | **Snapshot bridge: ADS/DSCR → facts → snapshot** | **✅ Complete** | **—** |
| **Phase 33** | **Institutional memo — Florida Armory standard** | **✅ Complete** | **b1233493** |
| Phase 30 remaining | Narratives, Classic Spreads, Reconciliation, Committee | 🔴 Active | — |
| Model Engine V2 | Feature flag + seeding + wiring | 🔴 Queued | — |
| Observability | Telemetry pipeline activation | 🔴 Queued | — |
| Corpus Expansion | 10+ verified docs across industries | 🔴 Queued | — |

---

*The mission: a system that proves itself right before delivery —
so bankers focus entirely on credit judgment.*
