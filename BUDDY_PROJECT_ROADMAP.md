# Buddy The Underwriter — Project Roadmap
# Institutional-Grade Commercial Lending AI Platform

**Last Updated: March 2026**
**Status: Phase 50 complete — Deal Truth Graph + Gap Resolution Engine live**

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
        ↓ Buddy Intelligence Engine (BIE)           ✅ Phase 35 — LIVE
        ↓ Memo Completion Wizard (stopgap)          ✅ Phase 48 — LIVE
        ↓ Ownership Entity auto-creation            ✅ Phase 49 — from 1040 OCR
        ↓ Deal Truth Graph + Gap Resolution         ✅ Phase 50 — LIVE
        ↓ Credit Memo (Florida Armory standard)     ✅ Phase 33
        ↓ Borrower Intake → auto-populates memo     🔴 Future (replaces wizard)
        ↓ Phase 51 — Full interactive credit session (voice/chat + gap drive)
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
### AAR 38–40 ✅ — Bridge fixes, maxDuration, supabaseAdmin
### AAR 41–44 ✅ — Research fixes, B&I Analysis populates
### Phase 35 ✅ — Buddy Intelligence Engine (7 threads, Google Search grounding)
### AAR 45 ✅ — Research deduplication + SBA language fix
### AAR 46 ✅ — BIE content priority + management per-sentence fix
### AAR 47 ✅ — Personal income spread key mismatch fixed
### Phase 48 ✅ — Generate Narratives unblocked + Memo Completion Wizard
### Phase 49 ✅ — Ownership entities permanent fix (column mismatch, UUID bio keys, auto-create from 1040 OCR)
### Phase 50 ✅ — Deal Truth Graph + Gap Resolution Engine

---

## Phase 50 — Deal Truth Graph + Gap Resolution Engine ✅ COMPLETE

### What was built (8 steps)

| Step | What | Status |
|---|---|---|
| 1 | 4 DB migrations: `resolution_status` on `deal_financial_facts`, `deal_gap_queue`, `deal_fact_conflicts`, `deal_transcript_uploads` | ✅ |
| 2 | 3 server functions in `src/lib/gapEngine/`: `computeDealGaps()`, `extractFactsFromTranscript()`, `resolveDealGap()` | ✅ |
| 3 | 4 API routes: `gap-queue` (GET+POST), `gap-queue/resolve`, `transcript-ingest`, `banker-session/start` | ✅ |
| 4 | `DealHealthPanel` — completeness %, gap list, confirm buttons | ✅ |
| 5 | `TranscriptUploadPanel` — source selector, extract + confirm workflow | ✅ |
| 6 | Pipeline wiring: `extractFactsFromDocument` + `runMission` trigger `computeDealGaps()` | ✅ |
| 7 | Page wiring: cockpit + credit memo | ✅ |
| 8 | Validation: `tsc` clean, all tables verified | ✅ |

### Type fixes applied during build (spec adaptations)

- `source_type: "MANUAL"` instead of `"BANKER_INPUT"` — not in `FinancialFactSourceType` union
- Removed `extraction_path` from banker-provided provenance — not in `FinancialFactProvenance` type
- `bankId` null-guard in `runMission` — function requires `string`, not `string | null`

These are expected — the spec cannot know runtime type constraints without running `tsc`.
This confirms the review workflow (spec → Claude inspection → Antigravity build) is working correctly.

### Architectural decisions (preserved from ChatGPT concept spec)

- **"Resolve uncertainty" not "ask questions"** — the gap queue drives all human interaction
- **"Deal Health / Resolve N Open Items"** — the UI metaphor, never "Start Intake"
- **No subjective data ever stored** — `extractFactsFromTranscript()` prompt explicitly
  instructs the model to skip qualitative assessments; only verifiable facts are extracted
- **Single ledger** — every resolution emits a `deal_events` ledger event
- **Confidence thresholds** — ADE 0.85, BIE 0.65, transcript 0.60, banker confirmed 1.00

### What Phase 50 does NOT do (Phase 51)

- Does NOT deprecate `deal_memo_overrides` — wizard remains as fallback
- Does NOT wire voice/chat session transcript → auto-confirm facts in real time
- Does NOT build the full interactive credit interview UI
- Does NOT wire `buildCanonicalCreditMemo` to read confirmed facts instead of overrides

---

## Current State — Active Deals

**Deal ffcc9733** — Samaritus Management LLC (primary active test deal)
- 9/9 docs. NET_INCOME = $204,096 (2025). ADS = $67,368. DSCR = 4.27x.
- ✅ AI Risk: BB+ grade, 975 bps
- ✅ BIE: LIVE — 9 memo subsections with Gemini-written content
- ✅ Generate Narratives: unblocked
- ✅ Wizard: qualitative fields saved
- ✅ Ownership entities: column mismatch fixed, auto-create wired
- ✅ Deal Health Panel: live — shows completeness % and open gaps
- ✅ Transcript Upload: live — paste Otter/Fireflies → extract + confirm
- 🔴 Management bio: retype Ialacci bio in wizard (old key stale)
- 🔴 Reconciliation: `recon_status` NULL — blocks Committee signal

---

## Known Gaps — Priority Order

### P1 — Immediate

1. **Retype Ialacci bio** — re-open wizard, one-time retype under UUID key
2. **Generate Narratives** — confirm Executive Summary shows Gemini prose
3. **Reconciliation** — `recon_status` NULL blocks Committee Approve signal

### P2 — Near Term (Phase 51 + Borrower Intake)

- **Phase 51 — Full Credit Interview Session** — voice/chat layer as gap-queue driver;
  session transcript → auto-confirm facts in real time; wire `buildCanonicalCreditMemo`
  to read confirmed facts; deprecate `deal_memo_overrides`
- **Borrower Intake pipeline** — voice interview + intake forms → auto-populate
  `business_summary` and `management_qualifications` (replaces wizard permanently)
- **Model Engine V2 activation** — feature flag disabled, DB tables empty
- **Observability pipeline** — missing env vars, Pulse events not flowing
- **Corpus expansion** — 2 docs. Need 10+ for bank confidence
- **Projection years** — Year 1/Year 2 rows in debt coverage + income statement
- **BIE vertical packs** — healthcare, construction, transportation, food service (Phase 36)
- **NAICS SBA historical stats** — Lumos integration for eligibility section

### P3 — Future

- chatAboutDeal Gemini migration
- Crypto lending module (6-layer architecture designed, not built)
- Treasury product auto-proposal engine
- RMA peer/industry comparison
- Voice system guardrails (voice_profiles.ts exists but not injected into OpenAI realtime)

---

## Workflow — How Specs Are Built

**Architecture review process (established after Phase 50 near-miss):**
1. ChatGPT produces architecture concept + spec draft
2. Claude inspects spec against live codebase (schema, types, existing functions)
3. Claude produces corrected build-ready spec (saved as `PHASE_XX_SPEC.md` in repo root)
4. Antigravity implements from the corrected spec only
5. AAR documents type fixes applied during build (expected — spec can't run `tsc`)

This prevents parallel system construction (the Pulse problem) and schema drift.

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
| Gap Engine | `src/lib/gapEngine/` — computeDealGaps, extractFactsFromTranscript, resolveDealGap |
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
| **Buddy Intelligence Engine** | **gemini-3.1-pro-preview** | **GEMINI_API_KEY (Dev API)** | **✅ LIVE — 9 sections rendering** |
| **Generate Narratives** | **Gemini Flash** | **GEMINI_API_KEY (Dev API)** | **✅ LIVE** |
| **Transcript extraction** | **Gemini Flash** | **GEMINI_API_KEY (Dev API)** | **✅ LIVE — Phase 50** |
| chatAboutDeal | OpenAI gpt-4o-2024-08-06 | OpenAI API key | 🔴 Gemini migration queued (P3) |

---

## Definition of Done — God Tier

1–61. ✅ All prior phases and AARs complete through Phase 35 + AARs 45/46/47 + Phases 48/49/50.
62. 🔴 Ialacci bio retyped — Management Qualifications complete
63. 🔴 Generate Narratives confirmed — Executive Summary shows Gemini prose
64. 🔴 Reconciliation complete — Committee Approve signal unlocked
65. 🔴 Phase 51 — Full credit interview session live (voice/chat drives gap queue)
66. 🔴 Borrower Intake wired — wizard deprecated, qualitative fields auto-populate
67. 🔴 Spread completeness ≥80%
68. 🔴 Banker opens a deal, 10-minute voice session resolves all gaps, memo auto-completes

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
- **Routes that do non-trivial async work must set `export const runtime = "nodejs"` and `export const maxDuration = 60`. BIE research route uses `maxDuration = 300`. Every route that calls Gemini must have this — missing maxDuration causes silent timeout at platform default.**
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
- **`"Summary"` must not be included in the `industry_overview` sectionsToText bucket — BRE Summary draws from all inferences including lender_fit, which contains SBA program language.**
- **When BIE narrative (version 3) exists, use `extractBIESection()` directly — never `sectionsToText(pack, ...)` for the four core fields.**
- **BIE management sections must be stored per-sentence, not as concatenated string blobs. Concatenation strips whitespace boundaries on render.**
- **Personal income extraction for PTR documents must use the deterministic extractor — Gemini primary writes non-canonical fact keys.**
- **Personal income spread `ROW_REGISTRY` factKeys: `TAXABLE_INTEREST` (not `INTEREST_INCOME`), `ORDINARY_DIVIDENDS` (not `DIVIDEND_INCOME`), `SCH_E_NET` (not `SCHED_E_NET`).**
- **Spread template `factKey` is the DB lookup contract. When extractor and template use different key names, cells silently render null.**
- **`TOTAL_PERSONAL_INCOME` must be guarded against stale negative DB values — recalculate from components if stored total is negative.**
- **`deal_memo_overrides` is a stopgap for qualitative memo fields. Deprecated when borrower intake auto-populates these fields. Never use for numeric/computed fields.**
- **The wizard must never ask bankers to manually enter numbers. The wizard is strictly for narrative qualitative fields.**
- **`ownership_entities` correct columns: `id`, `deal_id`, `entity_type`, `display_name`, `tax_id_last4`, `meta_json`, `confidence`, `evidence_json`, `created_at`, `ownership_pct`, `title`. Never reference `name`, `legal_name` — those don't exist.**
- **Principal bio keys in `deal_memo_overrides` use UUID format: `principal_bio_<ownership_entity_uuid>`. Name-derived slugs are fragile — UUIDs are the contract.**
- **`ownership_entities` rows must be auto-created during personal doc extraction (1040, PFS) using `ensureOwnerEntity()`. Always upsert idempotently by `(deal_id, display_name)`.**
- **When a CSS context inherits a non-black text color, always set `text-gray-900 bg-white` and `placeholder-gray-400` explicitly on every `<input>` and `<textarea>`. Omitting causes white-on-white invisible text.**
- **`deal_financial_facts` is the canonical fact store. Never build a parallel `deal_facts` table. The Gap Resolution Engine extends `deal_financial_facts` via `resolution_status` — it does not replace it.**
- **`deal_gap_queue` unique constraint is `(deal_id, fact_type, fact_key, gap_type, status)` — prevents duplicate open gaps for the same fact.**
- **`computeDealGaps()` must be called after every extraction run and every BIE mission. Wire as non-fatal fire-and-forget at the end of both pipelines.**
- **`extractFactsFromTranscript()` prompt must explicitly instruct the model to skip subjective assessments. Only verifiable, documentable facts are stored. This is a fair lending compliance requirement.**
- **Banker-provided facts (from voice/chat/transcript confirmation) use `source_type: "MANUAL"` and `confidence: 1.00`. They set `resolution_status = "confirmed"` on the fact.**
- **`FinancialFactProvenance` does not have an `extraction_path` field. Do not add it to banker-provided provenance objects.**
- **Architecture review workflow: ChatGPT drafts spec → Claude inspects against live schema + types → Claude produces corrected spec in `PHASE_XX_SPEC.md` → Antigravity builds from corrected spec only. This prevents parallel system construction (the Pulse/deal_facts problem).**

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
| AAR 38–40 | Bridge fixes, maxDuration, supabaseAdmin | ✅ Complete | various |
| AAR 41–44 | Research fixes, B&I Analysis populates | ✅ Complete | various |
| Phase 35 | Buddy Intelligence Engine — 7 threads, Google Search grounding | ✅ Complete | — |
| AAR 45 | Research deduplication + SBA language fix | ✅ Complete | — |
| AAR 46 | BIE content priority + management per-sentence fix | ✅ Complete | — |
| AAR 47 | Personal income spread factKey fix + alias fallback + negative total guard | ✅ Complete | — |
| Phase 48A | Narratives route `maxDuration=60` | ✅ Complete | — |
| Phase 48B | Memo Completion Wizard — `deal_memo_overrides`, qualitative stopgap | ✅ Complete | — |
| Phase 49 | Ownership entities permanent fix — column mismatch, UUID bio keys, auto-create from 1040 OCR | ✅ Complete | — |
| **Phase 50** | **Deal Truth Graph + Gap Resolution Engine — gap queue, conflict detection, transcript ingestion, Deal Health Panel, banker session start** | **✅ Complete** | **—** |
| Retype Ialacci bio | Re-open wizard, retype bio under UUID key (one-time) | 🔴 Next | — |
| Generate Narratives | Confirm Gemini prose in Executive Summary + Borrower sections | 🔴 Next | — |
| Reconciliation | `recon_status` — Committee Approve signal | 🔴 Active | — |
| **Phase 51** | **Full Credit Interview Session — voice/chat drives gap queue in real time, auto-confirm facts, deprecate `deal_memo_overrides`** | **🔴 Queued** | **—** |
| Borrower Intake | Voice interview + forms → auto-populate memo (replaces wizard) | 🔴 Queued | — |
| Model Engine V2 | Feature flag + seeding + wiring | 🔴 Queued | — |
| Observability | Telemetry pipeline activation | 🔴 Queued | — |
| Corpus Expansion | 10+ verified docs across industries | 🔴 Queued | — |

---

*The mission: a system that proves itself right before delivery —
so bankers focus entirely on credit judgment.*
