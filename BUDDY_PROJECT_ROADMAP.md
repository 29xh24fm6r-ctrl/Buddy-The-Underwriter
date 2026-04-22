# Buddy The Underwriter — Project Roadmap
# Institutional-Grade Commercial Lending AI Platform

**Last Updated: April 22, 2026**
**Status: Phase 84 closing (9 of 10 tickets complete) — see `docs/archive/phase-84/` for per-ticket AARs. Active test pack run in progress — see AAR 2026-04-22.**
**Most recent architectural work: Phases 68–83 (ignite wizard, joint-filer intelligence, proof-of-truth, classification supremacy, lease/credit-memo). Historical phase AARs + specs in `docs/archive/phase-pre-84/` after T-10A archival.**

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

## Spec Governance — How We Build

**ChatGPT:** Architecture, UX concepts, business logic, spec drafting.
**Claude:** Schema reconciliation, codebase alignment, build-ready spec production.
**Antigravity:** Implementation against Claude-reconciled spec only.

Antigravity never receives a raw ChatGPT spec. Claude inspects every spec against
the live codebase before it touches code. This prevents parallel system duplication.

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
        ↓ Deal Truth Graph + Gap Resolution Engine  ✅ Phase 50 — LIVE
        ↓ Banker Credit Interview (Gemini Live)     ✅ Phase 51 — LIVE
        ↓ Cockpit Redesign (Story tab, Status Strip) ✅ Phase 52 — LIVE
        ↓ Deal Builder (workflow rail, drawers)     ✅ Phase 53A — LIVE
        ↓ Credit Memo (Florida Armory standard)     ✅ Phase 33
        ↓ Borrower Intake → auto-populates memo     🔴 Future (replaces wizard)
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
### Phase 35 ✅ — Buddy Intelligence Engine built (7 threads, Google Search grounding)
### AAR 45 ✅ — Research deduplication + SBA language fix
### AAR 46 ✅ — BIE content priority + management per-sentence fix
### AAR 47 ✅ — Personal income spread key mismatch fixed
### Phase 48 ✅ — Generate Narratives unblocked + Memo Completion Wizard
### Phase 49 ✅ — Ownership entities permanent fix
### Phase 50 ✅ — Deal Truth Graph + Gap Resolution Engine
### Phase 51 ✅ — Buddy Voice Gateway (Gemini Live, Fly.io)
### Phase 52 ✅ — Cockpit Redesign (Status Strip, Story tab, 5 workspace tabs)
### Phase 53A ✅ — Deal Builder (workflow rail, modal/drawer UX, milestone readiness) — commit 22bac029

---

## Phase 53A — Deal Builder ✅ COMPLETE
**Commit:** 22bac029 | **42 files, 3,825 lines**
See AAR_PHASE_53A.md for full detail.
Completed God Tier item #65 — Borrower Intake wired.

---

## Phase 52 — Cockpit Redesign ✅ COMPLETE

### What was built (10 steps, tsc clean)

| Item | What | Status |
|---|---|---|
| StatusChip.tsx | Expandable pill chip with localStorage persistence per dealId | ✅ |
| StatusStrip.tsx | Compact single-row status strip replacing the 3-column grid | ✅ |
| StoryPanel.tsx | New Story tab — Buddy's Questions + Deal Story fields + Credit Interview | ✅ |
| DocumentsTabPanel.tsx | New Documents tab — DealFilesCard + CoreDocuments + ArtifactPipeline | ✅ |
| story/questions/route.ts | API: BIE underwriting questions + missing fact gaps | ✅ |
| memo-overrides/route.ts | API: GET/PATCH story field overrides (merge, not replace) | ✅ |
| DealIntakeCard.tsx | Fixed CSS bug: text-white + placeholder color on borrower inputs | ✅ |
| SecondaryTabsPanel.tsx | 5 tabs (Setup/Story/Documents/Underwriting/Timeline), removed Portal + Spreads | ✅ |
| DealCockpitClient.tsx | Replaced 3-column grid with StatusStrip | ✅ |
| cockpit/page.tsx | Removed dangling DealHealthPanel + BankerVoicePanel (now in Story tab) | ✅ |

### Architecture

**Before:**
```
[Hero Header]
[3-column grid: Left(4 panels) | Center(Checklist) | Right(Readiness)]
[Secondary Tabs: Setup | Portal | Underwriting | Spreads | Timeline]
[DealHealthPanel]  ← bolted below
[BankerVoicePanel] ← bolted below
```

**After:**
```
[Hero Header]
[Status Strip: Documents | Checklist | Pipeline | Readiness | → CTA]
[Workspace Tabs: Setup | Story | Documents | Underwriting | Timeline]
```

### Story tab — what it collects

**Section 1 — Buddy's Questions:** BIE `underwriting_questions` from `buddy_research_narratives` (version 3) + `missing_fact` gaps from `deal_gap_queue`. Each question has a text answer field that saves to `deal_memo_overrides`.

**Section 2 — Deal Story Fields:** 6 guided textarea fields that feed directly into the credit memo. Debounced PATCH to `deal_memo_overrides` on change.
- Use of Proceeds (`use_of_proceeds`)
- Management Background (`principal_background`)
- Collateral (`collateral_description`)
- Banking Relationship (`banking_relationship`)
- Deal Strengths (`key_strengths`)
- Deal Weaknesses & Mitigants (`key_weaknesses`)

**Section 3 — Credit Interview:** DealHealthPanel (data completeness) + BankerVoicePanel (Gemini Live voice session) + collapsed TranscriptUploadPanel.

### Key design principles enforced
- Status strip chips expand inline — no modals, no page navigations
- Story tab defaults when deal is ignited (`intakePhase` is set)
- Portal controls collapsed inside Setup under "Borrower Portal"
- AI Doc Recognition moved to Documents tab where it belongs
- Nothing deleted — all components reused, just reorganized

---

## Phase 51 — Buddy Voice Gateway (Gemini Live) ✅ COMPLETE

### What was built (4 parts, tsc clean)

| Part | What | Status |
|---|---|---|
| A | `buddy-voice-gateway/` — 9-file standalone Node.js WS server | ✅ |
| B | DB migration (`deal_voice_sessions`) + 6 Next.js files | ✅ |
| D | Deleted 3 OpenAI voice routes (realtime/session, realtime/sdp, banker-session/start) | ✅ |
| E | BankerVoicePanel wired into cockpit + credit memo pages | ✅ |

### Architecture

```
Browser
  → POST /api/deals/[dealId]/banker-session/gemini-token (Vercel)
      ← { proxyToken, sessionId } stored in deal_voice_sessions
  → WebSocket wss://buddy-voice-gateway.fly.dev/gemini-live?token=X&sessionId=Y
      gateway validates token against Supabase
      gateway opens upstream WebSocket to Vertex AI Gemini Live
      BIDIRECTIONAL RELAY: browser audio ↔ Gemini audio (API key never touches browser)
      tool calls intercepted server-side → POST /api/deals/[dealId]/banker-session/dispatch
          dispatch → resolveDealGap() → deal_financial_facts (resolution_status=confirmed)
          dispatch → deal_events ledger entry (voice.fact_confirmed)
```

### Key properties
- **Zero OpenAI** — Gemini handles STT + LLM + TTS natively in a single WebSocket
- **Model:** `gemini-live-2.5-flash-native-audio` via Vertex AI (same GCP project as extraction)
- **Auth:** GCP service account OAuth2 — same credential chain as document extraction
- **Proxy token:** 180s TTL UUID, stored in `deal_voice_sessions.metadata`
- **Gateway secret:** `BUDDY_GATEWAY_SECRET` shared between Fly.io and Vercel
- **Audio:** 16kHz PCM input (AudioWorklet `buddy-mic-processor.js`), 24kHz PCM output
- **Fly.io:** `buddy-voice-gateway`, `shared-cpu-1x`, 512mb, `min_machines_running = 1`
- **Compliance:** system instruction explicitly prohibits subjective content — fair lending enforced at prompt level

---

## Current State — Active Deals

**Test Deal `d65cc19e-b03e-4f2d-89ce-95ee69472cf3`** — "Test Deal 4-22-26 #1" on Old Glory Bank — **active banker-side test pack run (Run 1, Path B).** See AAR 2026-04-22.
- 9/9 docs uploaded: 3× BTR SAMARITUS (2022/23/24), 3× PTR NEWMARK (2022/23/24), 1× PFS, 1× Samaritus Balance Sheet 2025, 1× Samaritus P&L 2025.
- Pipeline state: intake → OCR → classification → raw-fact extraction all ran. 242 `deal_financial_facts`, 6 `deal_spreads`. Snapshot/recon correctly blocked at `LOAN_REQUEST_INCOMPLETE` preflight. Deal parked at `stage=collecting`.
- **D1 blocker surfaced:** gatekeeper classifier does not extract entity names (`ai_business_name`/`ai_borrower_name` NULL on all 9 docs). Deal's `display_name` stuck NULL. Fix spec drafted — D1.
- **D3 ledger pollution:** fastlane Pulse forwarder emits `pulse.forwarding_failed: pulse_mcp_disabled` on every checklist tick (missing `PULSE_MCP_ENABLED` env). Fix spec drafted — D3.
- **D2 external issue:** Omega MCP returns `Method not found` on all four resources Buddy calls (`omega://events/write`, `omega://confidence/evaluate`, `omega://state/underwriting_case/{id}`, `omega://traces/{id}`). Buddy side correct; Omega Prime side out of sync. Queued in Phase 84.1 backlog.
- Test pack resumes after D1+D3 merge: banker enters loan request → snapshot/recon/UW/approve.

**Prior canonical deal `ffcc9733` — Samaritus Management LLC** — **DELETED from prod during pre-Phase-84 cleanup.** Historical reference only.

---

## Known Gaps — Priority Order

### P1 — Immediate

1. ~~Apply builder migration~~ ✅ DONE — all 3 builder tables confirmed live in production with RLS
2. **Retype Ialacci bio** — re-open wizard, one-time retype under UUID key
3. **Reconciliation** — `recon_status` NULL blocks Committee Approve signal
4. **Ship D1 (classifier entity names) + D3 (fastlane silence)** — blocks clean test pack continuation. Specs drafted 2026-04-22.

### P2 — Near Term

- **`buildCanonicalCreditMemo` reads confirmed facts** — replace `deal_memo_overrides` with confirmed `deal_financial_facts`
- **Model Engine V2 activation** — feature flag disabled, DB tables empty
- **Observability pipeline** — distinguishes two paths: (a) **batch forwarder** (`PULSE_TELEMETRY_ENABLED` + `PULSE_BUDDY_INGEST_URL` + `PULSE_INGEST_TOKEN`) — confirmed working via PR #823 / commit `881ace13`; (b) **fastlane forwarder** (`PULSE_MCP_ENABLED` + `PULSE_MCP_URL`) — NOT configured, emits degraded signals on every event. D3 spec silences fastlane until configured. If real-time Pulse visibility is desired, set the fastlane env vars in Vercel.
- **Corpus expansion** — 2 docs, need 10+ for bank confidence
- **Projection years** — Year 1/Year 2 rows in debt coverage + income statement
- **BIE vertical packs** — healthcare, construction, transportation, food service (Phase 36)
- **NAICS SBA historical stats** — Lumos integration for eligibility section

### P3 — Future

- chatAboutDeal Gemini migration
- Crypto lending module (6-layer architecture designed, not built)
- Treasury product auto-proposal engine
- RMA peer/industry comparison

---

## Technical Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js, Tailwind, Vercel |
| Database | Supabase (PostgreSQL) |
| AI — Extraction | Gemini 2.0 Flash via Vertex AI (GOOGLE_CLOUD_PROJECT + GCP ADC) |
| AI — Voice | `gemini-live-2.5-flash-native-audio` via Vertex AI — Fly.io gateway |
| AI — Reasoning | Gemini Flash via Developer API (GEMINI_API_KEY) |
| AI — Research | gemini-3.1-pro-preview via Developer API (GEMINI_API_KEY) — BIE |
| AI — Transcript | Gemini Flash via Developer API (GEMINI_API_KEY) |
| Voice Gateway | Node.js 20 ESM, `ws` library, `google-auth-library`, Fly.io |
| Integration | MCP (Model Context Protocol) |
| Event Ledger | Supabase `deal_events` (append-only) |
| Gap Engine | `src/lib/gapEngine/` — computeDealGaps, extractFactsFromTranscript, resolveDealGap |
| PDF Generation | PDFKit (portrait 8.5×11, serverExternalPackages) |
| Deployment | Vercel (frontend) + Fly.io (voice gateway) |
| Testing | Vitest, Playwright |

---

## AI Provider Inventory

| Workload | Model | Auth | Status |
|----------|-------|------|--------|
| Document extraction | Gemini 2.0 Flash | Vertex AI / GCP ADC | ✅ Active |
| Classic Spread narrative | Gemini 2.0 Flash | Vertex AI / GCP ADC | ✅ Active |
| Document classification | Gemini 2.0 Flash | Vertex AI / GCP ADC | ✅ Active |
| **Voice interview** | **gemini-live-2.5-flash-native-audio** | **Vertex AI / GCP service account** | **✅ LIVE** |
| Risk + Memo orchestrator | Gemini Flash | GEMINI_API_KEY (Dev API) | ✅ **LIVE — BB+ on Samaritus** |
| **Buddy Intelligence Engine** | **gemini-3.1-pro-preview** | **GEMINI_API_KEY (Dev API)** | **✅ LIVE — 9 sections rendering** |
| **Generate Narratives** | **Gemini Flash** | **GEMINI_API_KEY (Dev API)** | **✅ LIVE** |
| **Transcript extraction** | **Gemini Flash** | **GEMINI_API_KEY (Dev API)** | **✅ LIVE — Phase 50** |
| chatAboutDeal | OpenAI gpt-4o-2024-08-06 | OpenAI API key | 🔴 Gemini migration queued (P3) |

**OpenAI is now used for one workload only: chatAboutDeal.** All voice is Gemini.

---

## Definition of Done — God Tier

1–62. ✅ All prior phases and AARs complete through Phase 52.
63. 🔴 Ialacci bio retyped — Management Qualifications complete
64. 🔴 Reconciliation complete — Committee Approve signal unlocked
65. ✅ Borrower Intake wired — Deal Builder live, data model in place, builder data feeds memo
66. 🔴 Spread completeness ≥80%
67. 🔴 Banker opens a deal, 10-minute voice session resolves all gaps, memo auto-completes

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
- **`deal_memo_overrides` is a stopgap for qualitative memo fields. Never use for numeric/computed fields.**
- **The wizard must never ask bankers to manually enter numbers. The wizard is strictly for narrative qualitative fields.**
- **`ownership_entities` correct columns: `id`, `deal_id`, `entity_type`, `display_name`, `tax_id_last4`, `meta_json`, `confidence`, `evidence_json`, `created_at`, `ownership_pct`, `title`. Never reference `name`, `legal_name` — those don't exist.**
- **Principal bio keys in `deal_memo_overrides` use UUID format: `principal_bio_<ownership_entity_uuid>`. Name-derived slugs are fragile — UUIDs are the contract.**
- **`ownership_entities` rows must be auto-created during personal doc extraction (1040, PFS) using `ensureOwnerEntity()`. Always upsert idempotently by `(deal_id, display_name)`.**
- **When a CSS context inherits a non-black text color, always set `text-gray-900 bg-white` and `placeholder-gray-400` explicitly on every `<input>` and `<textarea>`. Omitting causes white-on-white invisible text.**
- **`deal_financial_facts` is the canonical fact store. Never build a parallel `deal_facts` table.**
- **`deal_gap_queue` unique constraint is `(deal_id, fact_type, fact_key, gap_type, status)` — prevents duplicate open gaps.**
- **`computeDealGaps()` must be called after every extraction run and every BIE mission. Wire as non-fatal fire-and-forget.**
- **`extractFactsFromTranscript()` prompt must explicitly prohibit subjective assessments. Fair lending compliance requirement.**
- **Banker-provided facts use `source_type: "MANUAL"` and `confidence: 1.00`. They set `resolution_status = "confirmed"`.**
- **`FinancialFactProvenance` does not have an `extraction_path` field. Do not add it to banker-provided provenance objects.**
- **Architecture review workflow: ChatGPT drafts spec → Claude inspects against live schema + types → Claude produces corrected spec in `PHASE_XX_SPEC.md` → Antigravity builds from corrected spec only.**
- **Voice gateway is a standalone Fly.io Node.js service (`buddy-voice-gateway/`). It is NOT a Vercel serverless function. Vercel cannot hold persistent WebSockets.**
- **Gemini Live auth uses GCP service account OAuth2 (`google-auth-library`) — same credential chain as Vertex AI document extraction. Store as base64 JSON in `GOOGLE_SERVICE_ACCOUNT_KEY`.**
- **`deal_voice_sessions` stores the proxy token + all session config in `metadata jsonb`. Gateway reads this once on WS connect — never re-fetches during session.**
- **`BUDDY_GATEWAY_SECRET` is a shared secret between Fly.io gateway and Vercel. The `/banker-session/dispatch` route validates it via `x-gateway-secret` header before any DB write.**
- **Voice tool calls are intercepted by the gateway server-side and never relayed to the browser. The browser only receives audio + transcript events.**
- **`buddy-mic-processor.js` must be placed in `/public/audio/` so Next.js serves it as a static file. AudioWorklet `addModule()` requires a URL, not an import.**
- **Gemini Live audio: input 16kHz PCM mono (AudioWorklet), output 24kHz PCM (AudioContext). No third-party audio SDK needed.**
- **Single tool declaration pattern (from Pulse): one `buddy_query` / `pulse_query` tool handles all intents. Reduces token overhead (~80 tokens vs ~1500 for multiple tools).**
- **Cockpit layout: Status Strip (expandable chips) replaces 3-column grid. Story tab is the default when deal is ignited. DealHealthPanel and BankerVoicePanel live inside Story tab — never bolted below cockpit page.**
- **`buddy_research_narratives.sections` is a JSONB array `[{title, sentences:[{text}]}]`. Underwriting Questions text contains newline-separated questions — split on `\n+` and strip `^\d+\.\s*`.**
- **`memo-overrides` PATCH route must merge into existing JSONB, never replace. Use sequential select-then-update/insert, not upsert, to avoid wiping existing keys.**
- **Supabase CLI is the only migration path. Never apply migrations via the Supabase dashboard. Always create locally and apply via `supabase db push`. 248 migrations registered as of Phase 53A.**
- **Deal Builder entity model: `ownership_entities` is canonical in Phase 53A. Do NOT introduce `entities` or `deal_entities` tables until Phase 53B. Every owner save calls `ensureOwnerEntity()` — conflict key `(deal_id, display_name)`.**
- **Deal Builder section keys: `deal`, `business`, `parties`, `guarantors`, `structure`, `story`. `parties` (not `borrowers`) is the canonical key for owner data.**
- **Deal Builder drawers have explicit Save buttons. Workspace auto-save is debounced 500ms. Collateral/proceeds fire immediately on add/delete.**
- **Deal Builder milestone facts: `BUILDER_COMPLETION_PCT`, `CREDIT_READY_PCT`, `DOC_READY_PCT` written to `deal_financial_facts` after every section save. source_type = "COMPUTED", confidence = 1.00.**
- **Deal Builder story write-through: `competitive_position` and `committee_notes` are new keys in `deal_memo_overrides`. Always merge, never replace.**
- **`ssn_last4` (4 chars max) is the only SSN field in Phase 53A. Full SSN vault path is Phase 53C.**
- **Gatekeeper classifier is responsible for entity name extraction, not just type. Prompt must request `business_name` and `borrower_name` in `detected_signals`; writer must persist them to `deal_documents.ai_business_name` / `ai_borrower_name`. The naming engine depends on these fields — empty names mean `deals.display_name` stays NULL forever. (D1, AAR 2026-04-22)**
- **Fastlane Pulse forwarder (`src/lib/outbox/tryForwardToPulse.ts`) must not emit `pulse.forwarding_failed` for config-state errors (`pulse_mcp_disabled`, `url_missing`) — those are disabled states, not degradation. The batch forwarder is the system of record; the fastlane is an optional accelerator. Only emit degraded signals for real transport failures. (D3, AAR 2026-04-22)**
- **Omega MCP is advisory-only (SR 11-7 wall). Buddy's canonical pipeline must never depend on an Omega call succeeding. `invokeOmega` already returns `{ ok: false }` on failure without throwing — call sites must respect that contract and never treat Omega degradation as a pipeline blocker. (D2 confirmation, AAR 2026-04-22)**

---

## Phase 84 ✅ — System Audit Remediation (closing)

10-ticket phase closing 37 audit findings across 4 waves. RLS batch A, document classifier fix, observer dedup audit, runRecord wiring, checklist taxonomy audit, idempotency guard, narrow Omega fallback, governance writers audit, env/roadmap reconciliation, repo hygiene.

See `docs/archive/phase-84/` for per-ticket AARs and audit docs.

**Meta-finding:** zero non-test deals in production database — flagged as **T-08-G** (top of Phase 84.1 backlog) for product/sales clarification before prioritizing further governance build work.

**Wave 1 lesson:** T-02, T-03, T-06 all had partial existing-state fixes shipped between spec drafting and execution. "Stop the bleeding" tickets have a structural risk of being already-fixed by the time they queue. Pre-work earns its keep.

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
| Phase 48B | Memo Completion Wizard — `deal_memo_overrides` | ✅ Complete | — |
| Phase 49 | Ownership entities permanent fix — column mismatch, UUID bio keys, auto-create from 1040 OCR | ✅ Complete | — |
| Phase 50 | Deal Truth Graph + Gap Resolution Engine — 4 tables, gap engine, transcript upload, Deal Health Panel | ✅ Complete | — |
| Phase 51 | Buddy Voice Gateway — Gemini Live native audio, Fly.io, zero OpenAI, `buddy-voice-gateway/`, BankerVoicePanel | ✅ Complete | — |
| Phase 52 | Cockpit Redesign — Status Strip, Story tab, 5 workspace tabs, BIE questions surfaced, borrower input CSS fix | ✅ Complete | — |
| **Phase 53A** | **Deal Builder — workflow rail, 9 summary-first workspaces, modal/drawer UX, milestone readiness, 3 DB tables, 42 files** | **✅ Complete** | **22bac029** |
| Supabase CLI sync | 156 migrations renamed, schema_migrations repaired, supabase db push working | ✅ Complete | — |
| Retype Ialacci bio | Re-open wizard, retype bio under UUID key | 🔴 Next | — |
| Reconciliation | `recon_status` — Committee Approve signal | 🔴 Active | — |
| Borrower Intake | Voice interview + forms → auto-populate memo (replaces wizard) | 🔴 Queued | — |
| Model Engine V2 | Feature flag + seeding + wiring | 🔴 Queued | — |
| Observability | Telemetry pipeline activation | 🔴 Queued | — |
| Corpus Expansion | 10+ verified docs across industries | 🔴 Queued | — |
| **Phase 57** | **SBA Borrower Readiness Module** — 5-pass forward model, 3-scenario sensitivity, break-even, Gemini narrative, PDFKit package | **✅ Complete** | **0c777d2** |
| **Phase 58A** | **SBA Risk Profile Enhancement** — 4-factor scorer (industry/age/term/location), NAICS default benchmarks, new business protocol | **✅ Complete** | **0eb522a** |
| Phase 65A | Omega Advisory Panel — Pulse state view, ai_risk_runs fallback, compliance wall | ✅ Complete | see `docs/archive/phase-pre-84/AAR_PHASE_65A_OMEGA_PANEL.md` |
| Phases 68–70 | See `docs/archive/phase-pre-84/` for per-phase AARs | ✅ Complete | — |
| Phases 71–75 | Agent group + governance foundation (writers queued in Phase 84.1) | ✅ Complete | — |
| Phases 78–83 | Memo evidence metadata, joint-filer intelligence, proof-of-truth, classification supremacy, Ignite Wizard | ✅ Complete | — |
| **Phase 84** | **System audit remediation** — 10 tickets, 4 audit-only conversions, 6 implementations. See `docs/archive/phase-84/` | **🟡 Closing** | **9/10 complete** |
| **AAR 2026-04-22** | **Test Pack Run 1 (Samaritus, Path B) — D1/D3 specs drafted, D2 queued** | **🟡 Specs out** | **pending Claude Code** |

---

## Session AAR — March 29, 2026

### Phase 57 — SBA Borrower Readiness Module ✅
**Commit:** 0c777d2 | **Tables:** 2 | **Routes:** 4 | **Components:** 4

5-pass deterministic forward model. 3-scenario sensitivity. Break-even. Two Gemini narrative calls. PDFKit 5-section borrower PDF. Critical bug fixed: `deals.loan_type` → `deals.deal_type`, value `'SBA'` not `'sba_7a'`. Fixed across 10 files. All SBA type checks now use `['SBA', 'sba_7a', 'sba_504', 'sba_express']`.

### Phase 58A — SBA Risk Profile Enhancement ✅
**Commits:** 4c5225f (initial) + 0eb522a (spec-aligned rebuild) | **Tables:** 1 + 6 columns | **Files:** 7

Initial build had wrong DB column names, synthetic rates, 0-100 scale. Spec-aligned rebuild corrected all deviations. Real 899k loan dataset rates (7.8–28.2%). Four weighted factors: industry 40%, business age 35%, loan term 15%, urban/rural 10%. `newBusinessProtocol.ts` SOP 50 10 8 compliant — DSCR 1.25x projected (new) vs 1.10x historical (existing). `SBARiskProfilePanel` positioned at top of SBA Package tab before assumption interview.

---

## Session AAR — April 22, 2026

### Test Pack Run 1 — Samaritus (Path B, banker-side full pipeline) 🟡 IN PROGRESS

**Deal:** `d65cc19e-b03e-4f2d-89ce-95ee69472cf3` ("Test Deal 4-22-26 #1") on Old Glory Bank.
**Scope:** full pipeline — intake → extraction → recon → UW → approve, via real document upload through the web UI.
**Outcome:** intake → OCR → classification → raw-fact extraction all ran. Pipeline correctly halted at loan-request preflight gate. Four adjacent defects surfaced during the run.

**Defects identified:**

- **D1 (blocking) — Gatekeeper classifier does not extract entity names.** `ai_business_name` / `ai_borrower_name` NULL on all 9 docs. Gemini prompt doesn't request them; response schema has no place for them. Naming engine has nothing to work with, `deals.display_name` stuck NULL. Spec drafted (`specs/aar-2026-04-22-test-pack-run-1/spec-d1-classifier-entity-names.md`).
- **D2 (external) — Omega Prime MCP returns `Method not found` for all four resources Buddy calls.** Buddy side correct. Needs investigation on the Omega Prime / Pulse side. Queued in Phase 84.1 backlog.
- **D3 (ledger pollution) — Fastlane Pulse forwarder emits degraded signals for missing config.** `PULSE_MCP_ENABLED` not set in Vercel; `pulse.forwarding_failed: pulse_mcp_disabled` fires on every checklist tick. Batch forwarder (separate env vars) confirmed working. Spec drafted (`specs/aar-2026-04-22-test-pack-run-1/spec-d3-fastlane-pulse-silence.md`).
- **D4 (one-off) — Single POST 500 on cockpit first load.** Sub-route truncated in Vercel logs. Likely Omega-coupled (D2); if D2 resolves, D4 goes away. No spec.
- **D6 (prompt tuning) — Gemini misclassified one PTR as `IRS_BUSINESS`.** Anchor router caught it (`canonical_type` correct). Low priority.
- **D7 (quality) — Samaritus Balance Sheet 2025 marked `SUSPECT` by extraction quality gate.** Recurring on Samaritus balance sheet; deeper investigation after test resumes.

**Non-defects flagged:**

- `stage=collecting` persisting is correct behavior — lifecycle engine honoring the "loan request required before snapshot" invariant.
- Stale `layout-...js` 404 in browser console — cache, not a bug.
- `doc_extractions` table has 0 rows despite 9 `deal_extraction_runs` — likely deprecated, facts now live in `deal_financial_facts`. Cleanup candidate, not urgent.

**Specs out for implementation:**

1. D1 — classifier entity-name extraction (3 files + 1 migration)
2. D3 — fastlane Pulse-disabled silence (1 file)

**Next:** Claude Code implements D1 + D3 → verify via the 4-step protocol in the AAR → banker enters a loan request → snapshot/recon/UW/approve fire → resume rest of test pack.

---

## Phase 58B — SBA Loan Sizing Intelligence 🔜

Deterministic calculation of expected SBA guarantee amount from SOP 50 10 8 schedule. Pure function `calculateSBAGuarantee(loanAmount, program)` → `{ guaranteePct, guaranteeAmount, bankExposure }`. Display in SBA Package tab header. No ML, no new tables beyond two additive columns on `buddy_sba_packages`.

**SBA 7(a) Guarantee Schedule:**
- Loans ≤ $150,000: 85% guarantee
- Loans > $150,000: 75% guarantee
- SBA Express: 50% guarantee
- Export Express: 90% (up to $500k)

---

## Phase 66 — Deal Initialization & Document Truth Foundation
**Status: ✅ SHIPPED**
**Commit: `89d7ae5`**

### Shipped
- `POST /api/deals/create`: borrower-first (auto-create or verify), name-always
  (rejects NEEDS NAME/UUID names), atomic deal_lifecycle + deal_readiness +
  deal_audit_log on insert
- `deal_document_items` table: canonical ledger, single source of truth
- `deal_document_snapshots` table: cached reducer output consumed by all panels
- `deal_audit_log` table: deal event audit trail (RLS applied, migration live)
- `requirementRegistry.ts`: 13 RequirementDefinition objects
- `matchDocumentToRequirement.ts`: canonical matcher only — personal returns
  need subject_id, tax returns need year, strict status taxonomy
- `recomputeDealDocumentState.ts`: 8-step pipeline
- 28 tests passing

### Permanent Rules Established
1. No deal without borrower
2. No deal without name
3. No intake completion without finalized_at (atomic)
4. No cockpit without clean joins — missing borrower is hard error
5. test-id stub permanently banned (`98beb96`)
6. One canonical document ledger — all panels read snapshot only
7. One canonical matcher — matchDocumentToRequirement only
8. Status taxonomy: uploaded ≠ classified ≠ confirmed ≠ validated ≠ satisfied ≠ ready
9. Blockers must reference requirement_code — vague "documents missing" banned

---

## Phase 67 — Cockpit UI Wiring to Canonical State
**Status: ✅ SHIPPED**
**Commit: `3092407` (refinements: `8d9dae6`)**

### Shipped
- `CockpitStateProvider` + `useCockpitStateContext` hook: single fetch shared
  across all panels, refetch() after every document action
- `CockpitBorrowerIdentity`: header wired to deal.borrower.legal_name exclusively;
  hard-fails on missing borrower — no soft "Borrower not set" fallback
- `CanonicalCoreDocumentsPanel`: reads cockpit-state.document_state.requirements;
  approved chip vocabulary only — "Validated" chip permanently removed
- `CanonicalChecklistPanel`: requirement-level rollups from cockpit-state;
  count = satisfied/waived required only, matches readiness count
- `ReadinessPanel`: reads cockpit-state.readiness categories; blockers read from
  cockpit-state.blockers with specific copy — no vague language
- `PanelAccessGate` + `safePanelFetch()`: 403s render local "Access restricted"
  only — never create phantom document blockers
- Backfill route (`backfill-document-state`): supports CRON_SECRET + superAdmin
  auth, accepts `{ dealIds?: string[] }` for targeting specific deals

### State as of this commit
- All four cockpit panels (Core Documents, Checklist, Readiness, Blockers) derive
  from single cockpit-state endpoint
- No panel makes independent document queries
- Permission failures isolated from readiness computation
- Pre-Phase-66 orphan deals require explicit backfill run before cockpit renders
  correctly (run backfill against Samaritus deal: `ffcc9733`)

---

## Underwriting Platform — Shipped Phases

| Phase | Name | Commit | Summary |
|-------|------|--------|---------|
| 54 | Deal Truth Integrity + Cockpit Readiness | `c6d5b2c` | Canonical deal creation, requirement registry, document ledger, cockpit-state endpoint |
| 55 | Deal Control Layer | `b4915f3` | Loan request system, document review actions, next-best-action, banker guidance |
| 56 | Underwriting Launch Control | `84f15d4` | Immutable launch snapshots, workspaces, drift detection, certification |
| 56R | Underwriting Launch Reconciliation | `85df80b` | Canonical loan request consolidation, launch wraps existing activation |
| 56R.1 | Fallback Removal + Launch Burn-In | `140ef66` | Exclusive canonical loan request, 25 regression tests |
| 57A | Analyst Workbench + Snapshot-Aware Execution | `1692b7c` | Workbench API, snapshot/drift banners, workstream cards, seed packages |
| 57B | Underwrite Access + Page UX | `bb1d3f0` | Underwrite tab in DealShell, AnalystWorkbench on underwrite page |
| 57C | Foundation Consolidation | — | Cockpit cleanup, route retirement, roadmap reconciliation |

### Current Underwriting Stack
- Canonical underwriting launch with immutable launch snapshots
- Underwriting workspace (AnalystWorkbench is primary)
- Canonical drift detection (canonical artifact reference comparison)
- Analyst workbench with snapshot-aware spread/memo/risk execution
- Explicit Underwrite tab in DealShell
- `/underwriter` and `/underwrite-console` retired (redirect to `/underwrite`)

### Do Not Duplicate (guardrail)
Underwriting launch, underwriting snapshots, underwriting workspace, drift detection,
and analyst workbench are now live. Future phases must extend these systems rather than
creating new underwriting control planes.

---

## Next Phases (priority order)

1. **Ship D1 + D3** (Test Pack Run 1 blockers, specs drafted 2026-04-22). Tight, shippable. Unblocks continuation of the banker-side test pack and fixes `deals.display_name` on every future deal.
2. **Phase 84.1 backlog** — see `docs/archive/phase-84/` for generated tickets, including the gating **T-08-G** (production activity baseline). Until T-08-G is answered ("are there any live paying banks?"), the rest of 84.1 priority ordering is provisional. Tickets queued: T-08-A (recon rarity), T-08-C (executeCanonicalAction never invoked), T-08-E (wire analyst-correction UI), T-08-B/D/F (governance writers), RLS Batch B, fact re-parenting, `.update()/.insert()` silent-error audit, **D2 — Omega MCP `Method not found` investigation (Buddy-side correct; Omega/Pulse side needs audit of exposed methods vs. what Buddy calls)**.
3. **Canonical Credit Memo Facts** — Replace `deal_memo_overrides` dependency for computed fields. Keep overrides only for qualitative banker-supplied narrative.
4. **Observability** — Activate fastlane telemetry if real-time Pulse visibility is desired (set `PULSE_MCP_ENABLED` + `PULSE_MCP_URL`). Batch forwarder already working. See D3 roadmap note.
5. **Model Engine V2** — Enable feature flag + seeding once observability exists.
6. **Borrower Intake** — Replace the stopgap wizard per core architecture.
7. **Corpus Expansion** — Needed for bank confidence and model quality.

---

*The mission: a system that proves itself right before delivery —
so bankers focus entirely on credit judgment.*
