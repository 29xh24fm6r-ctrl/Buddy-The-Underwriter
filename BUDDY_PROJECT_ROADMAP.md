# Buddy The Underwriter — Project Roadmap
# Institutional-Grade Commercial Lending AI Platform

**Last Updated: March 2026**
**Status: AAR 42 complete — research UUID fix + AI risk grade from result_json**

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

## Completed Phases

### PHASE 1–9 ✅ — PRs #169–#177
### Classic Banker Spread Sprint ✅ — PRs #180–#209
### Phases 10–24 ✅ — PRs #216–#229, commit dfdfc066
### AAR 20–34 ✅ — Full Gemini chain + AI Risk Assessment LIVE (BB+, 975 bps)
### Phase 31 ✅ — Research Engine activated + Credit Memo gated on research
### AAR 35–36 ✅ — Memo fixes
### Phase 32 ✅ — Snapshot bridge: ADS/DSCR → facts → snapshot
### Phase 33 ✅ — Institutional memo — Florida Armory standard (b1233493)
### AAR 37 ✅ — Legacy sections removed, Phase 33 memo primary (70d161bc)
### AAR 38 ✅ — Bridge → PDF route + `supabaseAdmin` in runMission
### AAR 39 ✅ — Bridge IIFE → awaited before response (a8915d9c)
### AAR 40 ✅ — `maxDuration=60` + direct upsert bridge, permanent (ce786ce1)
### AAR 41 ✅ — Research error logging + conditional SBA eligibility (ee38ec31)

---

## AAR 42 — Research UUID Fix + AI Risk Grade from result_json ✅ COMPLETE

**Commit `1aa5f955`**

**Fix 1 — `src/app/api/deals/[dealId]/research/run/route.ts`:**
Clerk's `userId` format (`"user_abc123"`) is not a UUID. Passing it to the
`created_by uuid` column caused a Postgres type error on every insert, killing
every research mission before it was created. Removed `import { auth }` and
`const { userId } = await auth()`. Changed `userId: userId ?? null` → `userId: null`.
Research missions now create successfully.

**Fix 2 — `src/lib/creditMemo/canonical/buildCanonicalCreditMemo.ts`:**
`ai_risk_runs` select was querying `factors` — a column that does not exist.
Actual columns: `id`, `deal_id`, `bank_id`, `grade`, `base_rate_bps`,
`risk_premium_bps`, `result_json`, `created_at`. Changed select to `result_json`.
Updated `aiRisk?.factors` → `aiRisk?.result_json?.factors` throughout. The memo
will now correctly display BB+ from the live AI risk run instead of falling back
to a calculated Risk Grade D.

**Fix 3 — Not needed:**
`deals.legal_name` Postgres errors are platform-wide background noise from other
routes, not from `buildCanonicalCreditMemo.ts`. That file correctly uses
`deals.name` already. `legal_name` references in the file are on `borrowers`
and `ownership_entities` tables where the column legitimately exists.

**Platform-wide issue tracked:** Multiple routes still query `deals.legal_name`
(does not exist) and `deals.amount` (should be `deals.loan_amount`). These cause
background Postgres errors but don't block the current flow. Fix when encountered
in active routes.

---

## Current State — Active Deals

**Deal ffcc9733** — "Claude Fix 19" (primary active test deal)
- `borrower_id = null`, `loan_amount = null` — foundational data gaps
- 9/9 docs. NET_INCOME = $204,096 (2025). ADS = $67,368.
- ✅ DSCR = 3.03x in facts + snapshot + header pill + financing box
- ✅ AI Risk: BB+ grade, 975 bps — now correctly sourced from `result_json`
- ✅ Research: Clerk UUID fix — missions should now create (AAR 42)
- ✅ Income statement rendering with real numbers ($1.36M revenue)
- ✅ Strengths: "Adequate debt service coverage (3.03x)" auto-populated
- ✅ SBA language gone, SBA Size Standard hidden for conventional deals

**Sequence after AAR 42 deploys:**
1. Credit Memo → Run Research — UUID fix means missions will create now
2. Credit Memo → Generate Narratives — Gemini 3 Flash with research context
3. Review memo — BB+ should display correctly, industry analysis populates

---

## Known Gaps — Priority Order

### P1 — Immediate

1. **✅ DSCR 3.03x** — written to facts + snapshot + memo
2. **✅ AAR 42** — research UUID fix + AI grade from result_json
3. **Run Research** — should now succeed after UUID fix
4. **Generate Narratives** — first research-grounded institutional memo
5. **Link deal to borrower** — `borrower_id` + `loan_amount` on ffcc9733 (needed for NAICS, eligibility, LTV)
6. **Reconciliation** — `recon_status` NULL. Blocks Committee.
7. **Platform-wide `deals.legal_name`** — multiple background routes use wrong column name

### P2 — Near Term

- **Model Engine V2 activation** — feature flag disabled, DB tables empty
- **Observability pipeline** — missing env vars
- **Corpus expansion** — 2 Samaritus docs. Need 10+
- **NAICS SBA historical stats** — Lumos integration for eligibility section
- **Management qualifications** — intake interview data capture
- **Projection years** — Year 1/Year 2 rows in debt coverage + income statement

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

1–56. ✅ All prior phases and AARs complete.
57. ✅ **Research UUID fix + AI risk grade from result_json (AAR 42)**
58. 🔴 Run Research — first live BRE mission completes
59. 🔴 Generate Narratives — first research-grounded institutional memo
60. 🔴 Memo shows BB+ risk grade correctly
61. 🔴 Deal ffcc9733: `borrower_id` and `loan_amount` set
62. 🔴 Reconciliation complete — Committee Approve signal unlocked
63. 🔴 Spread completeness ≥80%
64. 🔴 Banker experience — opens a spread, trusts every number, focuses on credit

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
- **`deals.loan_amount` is the correct column — not `deals.amount`. `deals.name` is correct — not `deals.legal_name`.**
- **DSCR and ADS must persist to `deal_financial_facts` after every spread generation.**
- **The canonical credit memo target standard is the Florida Armory SBA 7(a) write-up.**
- **Legacy DB tables superseded by new architecture must be removed from page queries entirely.**
- **Server-only library functions called from authenticated API routes must use `supabaseAdmin()`, not `createSupabaseServerClient()`.**
- **On Vercel serverless functions, fire-and-forget background promises are killed when the response is sent. Any work that must complete must be `await`ed before the response.**
- **Always trace the actual call chain from button click → API route before deciding where a bridge should live.**
- **Routes that do non-trivial async work must set `export const maxDuration = 60`.**
- **Two categories of facts: (1) Extracted from documents → `upsertDealFinancialFact`. (2) Computed structural facts → direct `sb.upsert()` with natural conflict key.**
- **Deal-type-aware content: `isSbaDeal` must be derived before rendering SBA-specific language.**
- **When server-side library functions return `{ ok: false }` silently, always log `error.code`, `error.details`, `error.hint` so Vercel surfaces the root cause.**
- **Clerk `userId` (format: `"user_abc123"`) is NOT a UUID. Never pass it to a `uuid` DB column. Use `null` for `created_by` on mission/job tables, or add a separate `clerk_user_id text` column if user attribution is needed.**
- **`ai_risk_runs` columns: `id`, `deal_id`, `bank_id`, `grade`, `base_rate_bps`, `risk_premium_bps`, `result_json`, `created_at`. Risk details (factors, rationale) live in `result_json` — not top-level columns.**
- **Before selecting any column from a table, verify it exists via `information_schema.columns`. Ghost columns (`deals.legal_name`, `deals.amount`, `ai_risk_runs.factors`) cause silent 500s that are hard to trace.**

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
| AAR 39 | Bridge IIFE → awaited before response | ✅ Complete | a8915d9c |
| AAR 40 | `maxDuration=60` + direct upsert bridge (permanent) | ✅ Complete | ce786ce1 |
| AAR 41 | Research error logging + conditional SBA eligibility | ✅ Complete | ee38ec31 |
| **AAR 42** | **Research UUID fix + AI risk grade from result_json** | **✅ Complete** | **1aa5f955** |
| Phase 30 remaining | Narratives, Reconciliation, Committee | 🔴 Active | — |
| Model Engine V2 | Feature flag + seeding + wiring | 🔴 Queued | — |
| Observability | Telemetry pipeline activation | 🔴 Queued | — |
| Corpus Expansion | 10+ verified docs across industries | 🔴 Queued | — |

---

*The mission: a system that proves itself right before delivery —
so bankers focus entirely on credit judgment.*
