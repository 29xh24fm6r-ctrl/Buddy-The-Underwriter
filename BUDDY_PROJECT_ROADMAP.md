# Buddy The Underwriter — Project Roadmap
# Institutional-Grade Commercial Lending AI Platform

**Last Updated: March 2026**
**Status: AAR 39 complete — bridge awaited before response, Vercel fire-and-forget eliminated**

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
### Phase 32 ✅ — Snapshot bridge: ADS/DSCR → facts → snapshot
### Phase 33 ✅ — Institutional memo — Florida Armory standard (b1233493)
### AAR 37 ✅ — Legacy sections removed — Phase 33 memo primary (70d161bc)
### AAR 38 ✅ — Bridge wired to PDF route + `supabaseAdmin` in runMission

---

## AAR 39 — Bridge Fire-and-Forget → Awaited ✅ COMPLETE

**Commit `a8915d9c`**

**Root cause:** The AAR 38 bridge used an immediately-invoked async arrow function
(IIFE / fire-and-forget pattern): `(async () => { ... })()`. On Vercel serverless
functions, execution terminates the instant the response is sent. The background
promise is killed before any `await`ed DB writes complete. Result: zero facts written
despite the bridge code being syntactically correct.

**Fix — `src/app/api/deals/[dealId]/classic-spread/route.ts`:**
Removed the IIFE entirely. Bridge is now a top-level `try/catch` block that `await`s
all DB operations (structural pricing query, facts query, `upsertDealFinancialFact`
× 4, `buildDealFinancialSnapshotForBank`, `persistFinancialSnapshot`) synchronously
before `return new NextResponse(...)`. The PDF response is returned after the bridge
completes. Non-fatal: the `try/catch` ensures the PDF always returns regardless.

**Build principle:** On Vercel serverless functions, fire-and-forget background
promises (`Promise`, IIFE, `.then()` without `await`, `setImmediate`, `setTimeout`)
are killed when the response is sent. Any work that must complete — DB writes,
telemetry, cache invalidation — must be `await`ed before the response. "Non-fatal"
means wrap in `try/catch`, not run in the background.

---

## Current State — Active Deals

**Deal ffcc9733** — "Claude Fix 19" (primary active test deal)
- `borrower_id = null`, `loan_amount = null` — foundational data gaps
- 9/9 docs extracted. NET_INCOME = $204,096 (2025). ADS = $67,368 (structural pricing).
- ✅ AI Risk Assessment: BB+ grade, 975 bps
- ✅ Phase 32 bridge: now awaited synchronously in PDF route (AAR 39)
- ✅ Research client: `supabaseAdmin()` throughout `runMission` (AAR 38)

**Sequence after AAR 39 deploys:**
1. Classic Spreads → Regenerate — bridge now awaits before response, DSCR/ADS write confirmed
2. Credit Memo → Run Research — first live BRE mission
3. Credit Memo → Generate Narratives
4. Review institutional memo with real numbers

**Expected DSCR:** NET_INCOME $204,096 / ADS $67,368 = **~3.03x**

---

## Known Gaps — Priority Order

### P1 — Immediate

1. **✅ All prior phases and AARs** — complete
2. **Classic Spreads → Regenerate** — deploy AAR 39 then click to write DSCR/ADS
3. **Run Research** — first live BRE mission
4. **Generate Narratives** — first research-grounded institutional memo
5. **Link deal to borrower** — `borrower_id` + `loan_amount` on ffcc9733
6. **Reconciliation** — `recon_status` NULL. Blocks Committee.

### P2 — Near Term

- **Model Engine V2 activation** — feature flag disabled, DB tables empty
- **Observability pipeline** — missing env vars
- **Corpus expansion** — 2 Samaritus docs. Need 10+
- **NAICS SBA historical stats** — Lumos integration for eligibility section
- **Management qualifications** — intake interview data capture
- **Projection years** — Year 1/Year 2 rows in tables

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

1–51. ✅ All prior phases and AARs complete.
52. ✅ Phase 32 bridge wired to PDF route + `supabaseAdmin` in runMission (AAR 38)
53. ✅ **Bridge fire-and-forget eliminated — awaited before response (AAR 39)**
54. 🔴 Classic Spreads regenerated — DSCR/ADS written to facts + snapshot
55. 🔴 Run Research — first live BRE mission completes
56. 🔴 Deal ffcc9733: `borrower_id` and `loan_amount` set
57. 🔴 Generate Credit Memo — first research-grounded institutional memo
58. 🔴 Reconciliation complete — Committee Approve signal unlocked
59. 🔴 Spread completeness ≥80%
60. 🔴 Banker experience — opens a spread, trusts every number, focuses on credit

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
- **DSCR and ADS must persist to `deal_financial_facts` after every spread generation.**
- **The canonical credit memo target standard is the Florida Armory SBA 7(a) write-up.**
- **Legacy DB tables superseded by new architecture must be removed from page queries entirely.**
- **Server-only library functions called from authenticated API routes must use `supabaseAdmin()`,
  not `createSupabaseServerClient()`. The user client requires an active Clerk session cookie
  unavailable in deeply nested server-side library calls.**
- **On Vercel serverless functions, fire-and-forget background promises (IIFE, `.then()` without
  `await`, `setTimeout`, `setImmediate`) are killed when the response is sent. Any work that must
  complete — DB writes, cache invalidation, telemetry — must be `await`ed before the response.
  "Non-fatal" means wrap in `try/catch`, not run in the background.**
- **Always trace the actual call chain from button click → API route before deciding where a
  bridge or side-effect should live.**

---

## Progress Tracker

| Phase | Description | Status | PR / Commit |
|-------|-------------|--------|-------------|
| 1–9 | Foundation phases | ✅ Complete | #169–#177 |
| 2C–3D through AAR 19 | Classic Banker Spread sprint | ✅ Complete | #180–#209 |
| Phase 10–24 | COS UI + AI Provider Migration | ✅ Complete | #216–#229, dfdfc066 |
| AAR 20–34 | Gemini chain + AI Risk LIVE | ✅ Complete | various |
| Phase 31 | Research Engine + Credit Memo gated | ✅ Complete | — |
| AAR 35–36 | Memo fixes | ✅ Complete | — |
| Phase 32 | Snapshot bridge | ✅ Complete | — |
| Phase 33 | Institutional memo — Florida Armory standard | ✅ Complete | b1233493 |
| AAR 37 | Legacy sections removed | ✅ Complete | 70d161bc |
| AAR 38 | Bridge → PDF route + supabaseAdmin in runMission | ✅ Complete | — |
| **AAR 39** | **Bridge fire-and-forget → awaited before response** | **✅ Complete** | **a8915d9c** |
| Phase 30 remaining | Narratives, Reconciliation, Committee | 🔴 Active | — |
| Model Engine V2 | Feature flag + seeding + wiring | 🔴 Queued | — |
| Observability | Telemetry pipeline activation | 🔴 Queued | — |
| Corpus Expansion | 10+ verified docs across industries | 🔴 Queued | — |

---

*The mission: a system that proves itself right before delivery —
so bankers focus entirely on credit judgment.*
