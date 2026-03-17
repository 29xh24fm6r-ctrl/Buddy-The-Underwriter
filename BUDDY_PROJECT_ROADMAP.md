# Buddy The Underwriter — Project Roadmap
# Institutional-Grade Commercial Lending AI Platform

**Last Updated: March 2026**
**Status: AAR 37 complete — canonical memo page cleaned up, Phase 33 layout now primary**

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

## Completed Phases — Foundation through COS UI Migration

### PHASE 1–9 ✅ COMPLETE — PRs #169–#177
### Classic Banker Spread Sprint ✅ COMPLETE — PRs #180–#209
### Phases 10–24 ✅ COMPLETE — PRs #216–#229, commit dfdfc066
### AAR 20–34 ✅ — Full Gemini chain + AI Risk Assessment LIVE (BB+, 975 bps)
### Phase 31 ✅ — Research Engine activated + Credit Memo gated on research
### AAR 35 ✅ — Canonical memo error visible + RunResearchButton
### AAR 36 ✅ — `deals.loan_amount` fix + sequential borrower query

---

## Phase 32 — Snapshot Bridge ✅ COMPLETE

DSCR/ADS/CFA/Excess CF computed in `spread-intelligence/route.ts` and written back
to `deal_financial_facts` as FINANCIAL_ANALYSIS facts after every GET. Snapshot
immediately rebuilt and persisted. Triggered by "Regenerate" on Classic Spreads.
Zero deals had DSCR in snapshot before this fix — platform-wide gap now closed.

---

## Phase 33 — Institutional-Grade Credit Memo (Florida Armory Standard) ✅ COMPLETE

Commit `b1233493`. Full rebuild of types, builder, and template to match the
18-section Florida Armory SBA 7(a) write-up exactly. 20 sections rendered:
Readiness → Header → Financing Request → Deal Summary → Sources & Uses →
Collateral (itemized, advance rates, lien positions) → Eligibility (NAICS, SBA stats) →
Business & Industry Analysis → Management Qualifications → Debt Coverage Table →
New Debt → Global CF Table → Income Statement Table → Repayment/Breakeven →
PFS per guarantor → Strengths & Weaknesses → Policy Exceptions → Proposed Terms →
Conditions (precedent, ongoing, insurance) → Recommendation + Approval signature block.

---

## AAR 37 — Canonical Memo Page Cleanup ✅ COMPLETE

**Commit `70d161bc`**

**Root cause:** The canonical memo page was rendering three stacked sections above
`CanonicalMemoTemplate`: (1) a legacy "Underwriting Narrative" block from
`financial_snapshot_decisions.narrative_json` — a dead legacy table hit; (2) SBA
Forms 1919/1920 — dominating the top of the page. The Phase 33 institutional memo
was rendering correctly below these but was being obscured.

**Fixes:**
- Removed `financial_snapshot_decisions` DB query entirely (was a legacy hit with no
  current value — that table is superseded by `canonical_memo_narratives`)
- Deleted the "Underwriting Narrative" block (narratives now live in `CanonicalMemoTemplate`)
- `eligibility` now calls `evaluateSbaEligibility()` directly — no `sba_json` branch
- SBA Forms moved to bottom of page inside a collapsed `<details>` element
- Net: −45 lines, tsc clean

**Final page order:**
1. Toolbar (Print View | Run Research | Generate Narratives | Export PDF)
2. `CanonicalMemoTemplate` — the full institutional memo
3. `SpreadsAppendix` — observed spreads
4. SBA Forms 1919/1920 — collapsed `<details>`, not primary

**Build principle:** Legacy DB tables that are superseded by new architecture must
be removed from page queries, not just hidden. Dead table hits add latency and
confusion. `financial_snapshot_decisions` is now fully retired from this page.

---

## Current State — Active Deals

**Deal ffcc9733** — "Claude Fix 19" (primary active test deal)
- `borrower_id = null`, `loan_amount = null` — foundational data gaps on this deal
- 9/9 docs extracted. Revenue: $1.36M (latest). ADS=$67,368 (structural pricing).
- ✅ AI Risk Assessment: BB+ grade, 975 bps
- ✅ Phase 32 bridge deployed — DSCR/ADS populate after Classic Spreads → Regenerate
- ✅ Phase 33 institutional memo deployed — renders cleanly after AAR 37

**Immediate sequence to get real numbers:**
1. Classic Spreads → Regenerate (fires Phase 32 bridge → DSCR/ADS into facts → snapshot)
2. Credit Memo → Run Research (first live BRE mission — diagnosing 500 error)
3. Credit Memo → Generate Narratives
4. Review Phase 33 memo with real data

**Research 500 error — needs Vercel logs to diagnose:**
Go to Vercel dashboard → Functions → `/api/deals/[dealId]/research/run` → recent
invocations → paste the actual error message. The route reaches `runMission()` and
throws somewhere inside. Cannot diagnose without the server-side stack trace.

---

## Known Gaps — Priority Order

### P1 — Immediate

1. **✅ AI Risk Assessment** — BB+ grade live
2. **✅ Phase 32** — Snapshot bridge deployed
3. **✅ Phase 33** — Institutional memo deployed
4. **✅ AAR 37** — Page cleaned up, memo now primary
5. **Classic Spreads → Regenerate** — fires Phase 32, populates DSCR/ADS
6. **Research 500** — get Vercel function logs, find root cause, fix
7. **Link deal to borrower** — set `borrower_id` + `loan_amount` on ffcc9733
8. **Reconciliation** — `recon_status` NULL. Blocks Committee.

### P2 — Near Term

- **Model Engine V2 activation** — feature flag disabled, DB tables empty
- **Observability pipeline** — missing env vars
- **Corpus expansion** — 2 Samaritus docs. Need 10+
- **NAICS SBA historical stats** — Lumos integration for eligibility section
- **Management qualifications** — intake interview data capture
- **Projection years** — Year 1/Year 2 rows in debt coverage + income statement tables

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
43. ✅ Research-grounded: minimal thinking (AAR 33)
44. ✅ AI Risk Assessment LIVE — BB+ grade, 975 bps (AAR 34)
45. ✅ Research Engine activated (Phase 31)
46. ✅ Credit Memo gated on research (Phase 31)
47. ✅ Canonical memo error visible + RunResearchButton (AAR 35)
48. ✅ `deals.loan_amount` fix + sequential borrower query (AAR 36)
49. ✅ Snapshot bridge: ADS/DSCR → facts → snapshot (Phase 32)
50. ✅ Institutional memo layout — Florida Armory standard (Phase 33)
51. ✅ **Legacy sections removed — Phase 33 memo is now primary (AAR 37)**
52. 🔴 Classic Spreads regenerated — activates Phase 32 bridge
53. 🔴 Research 500 fixed — first live BRE mission
54. 🔴 Deal ffcc9733: `borrower_id` and `loan_amount` set
55. 🔴 Generate Credit Memo — first research-grounded institutional memo
56. 🔴 Reconciliation complete — Committee Approve signal unlocked
57. 🔴 Spread completeness ≥80%
58. 🔴 Banker experience — opens a spread, trusts every number, focuses on credit

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
- Shadow mode for model migrations: ≥20 rows at ≥95% agree before cutover.
- **`zodToJsonSchema` + string name = `$ref`-wrapped. Use `{ $refStrategy: "none" }` for OpenAI.**
- **OpenAI strict mode requires `additionalProperties: false` recursively.**
- **`document_extracts` persistence is required for fact extraction to work.**
- **Completeness checker labels must exactly match `classicSpreadLoader` row labels.**
- **DSCR triangle reads from `deal_structural_pricing`, not `deal_financial_facts`.**
- **BTR-only years need TOTAL_OPERATING_EXPENSES and OPERATING_INCOME derived.**
- **Global CF personal income fallback: compute from raw `PERSONAL_INCOME` facts.**
- **`CURRENT_ASSETS` and `CURRENT_LIABILITIES` always derive from SL_ components.**
- **Gemini extraction (Vertex AI/GCP ADC) and Gemini 3 Flash orchestrator (GEMINI_API_KEY) are separate auth systems. Both must be present in Vercel.**
- **Gemini 3 Flash: `responseMimeType: "application/json"` only. `structureHint` in prompt. `thinkingLevel: "minimal"`. Evidence arrays `.optional().default([])`.**
- **Research must complete before credit memo generation.**
- **`runMission()` imported from `"@/lib/research/runMission"` directly — server-only.**
- **Error paths on server-rendered pages must use explicitly colored text on colored backgrounds.**
- **Never use Supabase join syntax without confirmed FK. Use sequential queries.**
- **`deals.loan_amount` is the correct column — not `deals.amount`.**
- **DSCR and ADS must persist to `deal_financial_facts` after every spread-intelligence call.**
- **The canonical credit memo target standard is the Florida Armory SBA 7(a) write-up.**
- **Legacy DB tables superseded by new architecture must be removed from page queries entirely — not just hidden. Dead table hits add latency and confusion.**

---

## Progress Tracker

| Phase | Description | Status | PR / Commit |
|-------|-------------|--------|-------------|
| 1–9 | Foundation phases | ✅ Complete | #169–#177 |
| 2C–3D through AAR 19 | Classic Banker Spread sprint | ✅ Complete | #180–#209 |
| Phase 10–24 | COS UI + AI Provider Migration | ✅ Complete | #216–#229, dfdfc066 |
| AAR 20–34 | Gemini chain + AI Risk LIVE | ✅ Complete | various |
| Phase 31 | Research Engine + Credit Memo gated | ✅ Complete | — |
| AAR 35 | Memo error visible + RunResearchButton | ✅ Complete | — |
| AAR 36 | `loan_amount` fix + sequential borrower query | ✅ Complete | — |
| Phase 32 | Snapshot bridge: ADS/DSCR → facts → snapshot | ✅ Complete | — |
| Phase 33 | Institutional memo — Florida Armory standard | ✅ Complete | b1233493 |
| **AAR 37** | **Legacy sections removed — Phase 33 memo primary** | **✅ Complete** | **70d161bc** |
| Research 500 | Fix runMission failure | 🔴 Active | — |
| Phase 30 remaining | Narratives, Reconciliation, Committee | 🔴 Active | — |
| Model Engine V2 | Feature flag + seeding + wiring | 🔴 Queued | — |
| Observability | Telemetry pipeline activation | 🔴 Queued | — |
| Corpus Expansion | 10+ verified docs across industries | 🔴 Queued | — |

---

*The mission: a system that proves itself right before delivery —
so bankers focus entirely on credit judgment.*
