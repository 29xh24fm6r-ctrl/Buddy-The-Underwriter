# Buddy The Underwriter — Project Roadmap
# Institutional-Grade Commercial Lending AI Platform

**Last Updated: March 2026**
**Status: AAR 45 complete — research deduplication fixed, BIE content pipeline unblocked**

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
        ↓ AI Risk Assessment (Gemini Flash)         ✅ BB+ LIVE
        ↓ Buddy Intelligence Engine (BIE)           ✅ Phase 35 + AAR 45
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
### AAR 42 ✅ — Research UUID fix + AI risk grade from result_json
### AAR 43 ✅ — `raw_content` nullable + explicit null fallback
### AAR 44 ✅ — Research section title mismatch fixed, B&I Analysis populates
### Phase 35 ✅ — Buddy Intelligence Engine built (7 threads, Google Search grounding)
### AAR 45 ✅ — Research deduplication + SBA language fix

---

## AAR 45 — Research Deduplication + SBA Language Fix ✅ COMPLETE

**3 changes to `src/lib/creditMemo/canonical/loadResearchForMemo.ts` only.**
`runMission.ts` confirmed correct — BIE wired at step 12b with proper persistence.

### Root Causes Found

**Bug 1 — Triple Industry Overview duplication**
`loadResearchForMemo.ts` loaded `.limit(20)` missions. This deal had 3 prior
`industry_landscape` missions → 3 "Industry Landscape" pack sections →
`sectionsToText()` concatenated all 3, producing identical paragraphs 3×.

**Bug 2 — SBA language bleeding into B&I Analysis**
`sectionsToText()` included `"Summary"` in the `industry_overview` bucket.
The BRE Summary section draws from all inferences including `lender_fit_analysis`,
which contains SBA program language. Summary content was never meant to map to
industry overview.

### Fixes Applied

| Change | File | Before | After |
|--------|------|--------|-------|
| Mission load limit | `loadResearchForMemo.ts` | `.limit(20)` | `.limit(1)` |
| missionIds array | `loadResearchForMemo.ts` | `missions.map(m => m.id)` | `[missions[0].id]` |
| industry_overview bucket | `loadResearchForMemo.ts` | includes `"Summary"` | `"Summary"` removed |

### Post-Fix Test Sequence

After deploying, run Research on the Samaritus deal (creates a fresh mission — only
this most recent one will be read). Check Vercel logs for:
`[runMission] BIE complete: quality=deep, sources=N`
Reload Credit Memo — Industry Analysis should show Gemini-written content, not
triplicated BRE stat blocks. No SBA language in B&I Analysis.

---

## Phase 35 — Buddy Intelligence Engine ✅ COMPLETE

**7 files, 1,225 net lines. tsc clean. Pipeline unblocked by AAR 45.**

### Architecture

**Model:** `gemini-3.1-pro-preview`
**Cost per loan:** ~$0.50–$0.65 (6 grounded calls + 1 synthesis)
**Execution:** Threads 1–5 parallel → Thread 6 (Transaction) → Thread 7 (Synthesis) sequential

**7 research threads:**
1. **Borrower Intelligence** — company profile, reputation, reviews, news, litigation, digital footprint
2. **Management Intelligence** — each principal's background, other ventures, track record, adverse events
3. **Competitive Intelligence** — named competitors, market position, barriers to entry, pricing environment
4. **Market Intelligence** — local economic conditions, demographics, CRE market, area risks
5. **Industry Intelligence** — sector size/growth, trends, disruption risks, margins, regulatory landscape, 5-year outlook, credit risk profile
6. **Transaction/Repayment Intelligence** — primary/secondary repayment, structure fit, downside case, stress scenario
7. **Credit Synthesis** — executive credit thesis, repayment strengths, core vulnerabilities, structure implications, underwriting questions, monitoring triggers, 3/5-year outlook, contradictions

**9 new memo subsections rendered:**
- Credit Thesis (blue left-border callout)
- Transaction & Repayment Analysis
- Structure Implications (amber, actionable)
- Key Underwriting Questions (rose, numbered checklist)
- Post-Close Monitoring Triggers (violet)
- Contradictions & Open Uncertainties (orange warning)
- 3-Year and 5-Year Outlook
- Management Intelligence
- Litigation & Adverse Events

**Key architectural decisions:**
- BIE is entirely non-fatal — any thread failure → `null`; whole BIE failure → mission already marked complete
- BIE only fires when `hasCompany || hasNaics` — skips generic fallback data
- Version 3 narrative upserts on `mission_id,version`, coexisting with BRE version 1
- `responseMimeType: "application/json"` omitted for grounded calls (Gemini 400 avoidance)
- BIE sections merge into `CreditCommitteePack` at read time via `.sentences`→`.content` conversion
- `loadResearchForMemo.ts` reads only most recent complete mission (AAR 45 fix)

**What this replaces:**
- IBISWorld subscription: $2,000–3,000/yr → $0.43/deal
- Bloomberg terminal: $25,000/yr → included
- Junior analyst research: $400–800/deal (8–12hrs) → 45–90 seconds

---

## Current State — Active Deals

**Deal ffcc9733** — Samaritus Management LLC (primary active test deal)
- 9/9 docs. NET_INCOME = $204,096 (2025). ADS = $67,368. DSCR = 3.03x.
- ✅ AI Risk: BB+ grade, 975 bps
- ✅ Research: deduplication fixed (AAR 45) — next Run Research will produce clean output
- ✅ BIE: wired and confirmed correct in runMission.ts step 12b
- ✅ B&I Analysis: SBA language bleed fixed (AAR 45)
- 🔴 First clean BIE run still needed — click Run Research to fire

**Immediate action:**
Click Run Research on Samaritus deal. Check Vercel logs for BIE completion.
Verify Credit Memo B&I Analysis shows Gemini-written content — not BRE stat blocks.

---

## Known Gaps — Priority Order

### P1 — Immediate

1. **Run Research on Samaritus** — first clean post-AAR-45 BIE execution
2. **Verify BIE memo sections render** — Credit Thesis, Structure Implications, Monitoring Triggers
3. **Generate Narratives** — Gemini Flash will now have BIE credit thesis as context
4. **Reconciliation** — `recon_status` NULL. Blocks Committee.

### P2 — Near Term

- **Model Engine V2 activation** — feature flag disabled, DB tables empty
- **Observability pipeline** — missing env vars, Pulse events not flowing
- **Corpus expansion** — 2 docs. Need 10+ for bank confidence
- **Management qualifications** — intake interview data capture
- **Projection years** — Year 1/Year 2 rows in debt coverage + income statement
- **PTR extractor** — Form 1040, Schedule E, Schedule F, Form 4562, Form 8825 not yet built
- **BIE vertical packs** — healthcare, construction, transportation, food service deepening (Phase 36)
- **NAICS SBA historical stats** — Lumos integration for eligibility section

### P3 — Future

- chatAboutDeal Gemini migration
- Crypto lending module (6-layer architecture designed, not built)
- Treasury product auto-proposal engine
- RMA peer/industry comparison
- Voice system guardrails (voice_profiles.ts exists but not injected into OpenAI realtime)

---

## Technical Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js, Tailwind, Vercel |
| Database | Supabase (PostgreSQL) |
| AI — Extraction | Gemini 2.0 Flash via Vertex AI (GOOGLE_CLOUD_PROJECT + GCP ADC) |
| AI — Voice | gpt-4o-realtime-preview (intentionally retained on OpenAI) |
| AI — Reasoning | Gemini Flash via Developer API (GEMINI_API_KEY) |
| AI — Research | gemini-3.1-pro-preview via Developer API (GEMINI_API_KEY) — BIE |
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
| Classic Spread narrative | Gemini 2.0 Flash | Vertex AI / GCP ADC | ✅ Active |
| Document classification | Gemini 2.0 Flash | Vertex AI / GCP ADC | ✅ Active |
| Voice interview sessions | gpt-4o-realtime-preview | OpenAI API key | ✅ Retained on OpenAI |
| Risk + Memo orchestrator | Gemini Flash | GEMINI_API_KEY (Dev API) | ✅ **LIVE — BB+ on Samaritus** |
| **Buddy Intelligence Engine** | **gemini-3.1-pro-preview** | **GEMINI_API_KEY (Dev API)** | **✅ Wired — first clean run pending** |
| chatAboutDeal | OpenAI gpt-4o-2024-08-06 | OpenAI API key | 🔴 Gemini migration queued (P3) |

---

## Definition of Done — God Tier

1–59. ✅ All prior phases and AARs complete through Phase 35 + AAR 45.
60. 🔴 Run Research on Samaritus — first clean 7-thread BIE execution post-deduplication fix
61. 🔴 Verify BIE memo sections: Credit Thesis, Structure Implications, Monitoring Triggers render
62. 🔴 Generate Narratives — first AI-written institutional memo with BIE context
63. 🔴 Reconciliation complete — Committee Approve signal unlocked
64. 🔴 Spread completeness ≥80%
65. 🔴 Banker experience — opens a spread, trusts every number, focuses on credit

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
- **Gemini extraction (Vertex AI/GCP ADC) and Gemini Flash orchestrator (GEMINI_API_KEY) are separate auth systems. Both must be present in Vercel.**
- **Gemini Flash: `responseMimeType: "application/json"` only. `structureHint` in prompt. `thinkingLevel: "minimal"`. Evidence arrays `.optional().default([])`.**
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
- **Routes that do non-trivial async work must set `export const maxDuration = 60`. BIE research route uses `maxDuration = 300`.**
- **Two categories of facts: (1) Extracted from documents → `upsertDealFinancialFact`. (2) Computed structural facts → direct `sb.upsert()` with natural conflict key.**
- **Deal-type-aware content: `isSbaDeal` must be derived before rendering SBA-specific language.**
- **When server-side library functions return `{ ok: false }` silently, always log `error.code`, `error.details`, `error.hint`.**
- **Clerk `userId` (format: `"user_abc123"`) is NOT a UUID. Never pass it to a `uuid` DB column.**
- **`ai_risk_runs` columns: `id`, `deal_id`, `bank_id`, `grade`, `base_rate_bps`, `risk_premium_bps`, `result_json`, `created_at`. Risk details live in `result_json` — not top-level columns.**
- **Before selecting any column from a table, verify it exists via `information_schema.columns`. Ghost columns cause silent 500s.**
- **`buddy_research_sources.raw_content` is nullable. Failed fetches have `fetch_error` populated and `raw_content = null` — correct semantic.**
- **Section title strings in consumer functions must exactly match what the producer outputs. BRE/BIE narrative section titles are the contract.**
- **BIE is non-fatal by design. Any thread failure returns `null`. Whole BIE failure is caught in step 12b — mission is already marked complete before BIE runs.**
- **BIE requires `hasCompany || hasNaics` to fire. Never runs on `999999` fallback NAICS with no company name.**
- **`gemini-3.1-pro-preview` + Google Search grounding: omit `responseMimeType: "application/json"` from `generationConfig` — use prompt-based JSON instruction only. MimeType + grounding causes 400.**
- **BIE `buddy_research_narratives` upserts as version 3, coexisting with BRE version 1 on the same `mission_id`. Conflict key is `(mission_id, version)`.**
- **`loadResearchForMemo.ts` uses `.limit(1)` — only the most recent complete mission. Never accumulate multiple missions — produces duplicate section content.**
- **`"Summary"` must not be included in the `industry_overview` sectionsToText bucket — BRE Summary section draws from all inferences including lender_fit, which contains SBA program language.**
- **Research section deduplication: when loadResearchForMemo loads multiple missions, each one generates a full pack section. The fix is always at the load layer (.limit(1)), not the render layer.**

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
| AAR 42 | Research UUID fix + AI risk grade from result_json | ✅ Complete | — |
| AAR 43 | `raw_content` nullable + explicit null fallback | ✅ Complete | — |
| AAR 44 | Research section title mismatch — B&I Analysis populates | ✅ Complete | — |
| Phase 35 | Buddy Intelligence Engine — 7 threads, Google Search grounding | ✅ Complete | — |
| **AAR 45** | **Research deduplication (.limit(1)) + SBA language fix ("Summary" removed)** | **✅ Complete** | **—** |
| First clean BIE run | Run Research post-fix, verify Gemini content in memo | 🔴 Next | — |
| Reconciliation | `recon_status` — Committee Approve signal | 🔴 Active | — |
| Model Engine V2 | Feature flag + seeding + wiring | 🔴 Queued | — |
| Observability | Telemetry pipeline activation | 🔴 Queued | — |
| PTR Extractor | Form 1040, Schedule E/F, 4562, 8825 | 🔴 Queued | — |
| Corpus Expansion | 10+ verified docs across industries | 🔴 Queued | — |

---

*The mission: a system that proves itself right before delivery —
so bankers focus entirely on credit judgment.*
