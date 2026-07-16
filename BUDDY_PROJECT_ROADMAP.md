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
### Fix A ✅ — Route consolidation after D5 outage (2053 → 2023, −15 routes, +25 cap headroom) — commits 99306b9e + 28d04057 + c53ca967 + <this-commit>. Final headroom 3 over FIX-C error threshold; enforcement flip deferred indefinitely per AUDIT.md Closing State.
### OMEGA-REPAIR ✅ — Omega wire-level repair + field mapping 2026-04-23 — commits aa4ded8a + 7d0550a5 + <this-commit>. Three bugs fixed: JSON-RPC method (`omega://` URIs → `tools/call`), auth header (`Authorization: Bearer` → `x-pulse-mcp-key`), and write-path field shape (Buddy envelope `type` → Pulse schema `event_type`, default `status: "success"`, extract `deal_id` from entities). Write + health paths wired to real Pulse tools (`buddy_ledger_write`, `mcp_tick`). Read path kill-switched with `pulse_advisory_tools_not_yet_available` pending PULSE-SIDE-SPEC.md. Pulse-side auth state confirmed inconsistent during rev 3.1 diagnostic — Batch 4 serves as authoritative auth test; persistent `http_401` is an acceptable ship state with Pulse-side auth diagnostic queued separately. `Method not found` signal eliminated regardless of auth outcome. Closes D2. Spec: `specs/omega-repair/SPEC.md` rev 3.3 at commit `9a6da9b5`.
### Phase 51 (revised) ✅ — 2026-07-15: Voice platform swapped from Gemini Live/Vertex AI back to OpenAI Realtime (`gpt-realtime`, flagship). `buddy-voice-gateway` now proxies `wss://api.openai.com/v1/realtime` instead of Vertex AI's BidiGenerateContent; client mic capture moved from 16kHz to 24kHz PCM16 to match OpenAI's required input format; token routes renamed `gemini-token` → `realtime-token`. Document extraction, classification, narrative, and research workloads are untouched — still Gemini.

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
- ~~**D2 external issue:** Omega MCP returns `Method not found` on all four resources Buddy calls.~~ **RESOLVED 2026-04-23 via OMEGA-REPAIR.** Root cause was Buddy-side, not external: wrong JSON-RPC method (`omega://` URIs used directly instead of `tools/call`), wrong auth header (`Bearer` instead of `x-pulse-mcp-key`), and wrong write-path field shape (spec rev 3.3 surfaced this during PIV). Fix: translator layer maps URIs → real Pulse tool names with explicit field mapping. Read path kill-switched pending Pulse-side deal-scoped advisory tools. Commits: aa4ded8a + 7d0550a5. See Completed Phases → OMEGA-REPAIR.
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
| AI — Voice | `gpt-realtime` via OpenAI Realtime API — Fly.io gateway |
| AI — Reasoning | Gemini Flash via Developer API (GEMINI_API_KEY) |
| AI — Research | gemini-3.1-pro-preview via Developer API (GEMINI_API_KEY) — BIE |
| AI — Transcript | Gemini Flash via Developer API (GEMINI_API_KEY) |
| Voice Gateway | Node.js 20 ESM, `ws` library, OpenAI Realtime WebSocket, Fly.io |
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
| **Voice interview** | **gpt-realtime** | **OpenAI API key (Fly.io gateway, server-side only)** | **✅ LIVE** |
| Risk + Memo orchestrator | Gemini Flash | GEMINI_API_KEY (Dev API) | ✅ **LIVE — BB+ on Samaritus** |
| **Buddy Intelligence Engine** | **gemini-3.1-pro-preview** | **GEMINI_API_KEY (Dev API)** | **✅ LIVE — 9 sections rendering** |
| **Generate Narratives** | **Gemini Flash** | **GEMINI_API_KEY (Dev API)** | **✅ LIVE** |
| **Transcript extraction** | **Gemini Flash** | **GEMINI_API_KEY (Dev API)** | **✅ LIVE — Phase 50** |
| chatAboutDeal | OpenAI gpt-4o-2024-08-06 | OpenAI API key | 🔴 Gemini migration queued (P3) |

**OpenAI now covers two workloads: chatAboutDeal and the realtime voice interview** (Phase 51's Gemini Live choice was reverted — see "Phase 51 (revised)" below). All other AI workloads (extraction, classification, narrative, research) remain Gemini.

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
- **Every API route called automatically by a cockpit panel on page mount must set `export const maxDuration = 60` (or higher), regardless of whether it calls Gemini. The platform default of 10s is too tight for any route that combines auth gating + multi-step Supabase I/O on a cold serverless instance. Cold-start timeouts surface as Vercel status `-` in logs and as silent UI degradation (loading spinners, disabled buttons, missing data) — never as visible errors. Audit triggered by Spec D5, AAR 2026-04-22.**
- **Status fetches that gate cockpit UI must go through `StatusFetchState<T>` (loading / ready / failed-with-retry). A silent catch that leaves the UI "disabled because the fetch failed" is indistinguishable from "disabled because no work to do". The failed state must offer a retry affordance. See `src/components/deals/statusFetchReducer.ts`. (D5, AAR 2026-04-22)**
- **Vercel enforces a hard cap of 2048 total routes per deployment, where "routes" is the union of app-router API routes + page routes + pages-router routes + middleware + `next.config` `headers()`/`redirects()`/`rewrites()` + their RSC variants + internal overhead. Exceeding the cap produces `errorCode: too_many_routes`, `errorMessage: "Maximum number of routes (rewrites, redirects, etc) exceeded"`, and `readyState: ERROR`, with NO fatal line in the build log stream (the error is written to deployment metadata during post-build deploy validation, not the build itself — `buildErrorAt` is null). As of 2026-04-22 post-Fix A (commits `99306b9e` + `28d04057`), we sit at **~2023 measured / ~25 routes of cap headroom** (was ~2053 pre-Fix A, essentially at the cap). `scripts/count-routes.mjs` provides PR-time observability (fast mode: source files × RSC multiplier + calibrated overhead; manifest mode: post-build `.next/routes-manifest.json` with the same formula). `.github/workflows/route-budget.yml` posts the count + delta on every PR — **advisory only for now**; enforcement (exit 1 at ≥2020) is deferred until Fix A (dedicated consolidation spec) brings the codebase under threshold with real cushion. Formula calibrated against `dpl_BwicDiAu3wRGAv1agSZqTy7zf6b9` (received=2055, 2026-04-22). Re-verify calibration on every Next.js major upgrade. Patterns that reduce count: merge GET+POST handlers into one `route.ts` rather than sibling `/status` directories; consolidate multiple `next.config.headers()` rules with the same policy using path-to-regexp alternation (`/:base(a|b|c)/:rest*`); prefer one catch-all `[...slug]` route over many explicit siblings. (FIX-C, AAR 2026-04-22)**
- **Build-failure diagnosis cannot rely on log tailing alone. Some Vercel error classes — confirmed so far: `too_many_routes`, and suspected for deploy-output size limits and function bundle validation errors — are written to deployment metadata (`errorCode`, `errorMessage`) rather than the build log stream. `vercel inspect --logs` and equivalents will terminate at `status ● Error` with no accompanying reason line. Any automation, runbook, or human diagnostic flow investigating a failed deploy must query `GET /v13/deployments/{id}` on the Vercel REST API first, read `errorCode` and `errorMessage`, and treat build-log content as a secondary source for build-phase errors only. Confirmed during Spec D5 diagnostic via the fix-d read-only task (2026-04-22). (FIX-D observation, AAR 2026-04-22)**
- **Audit-grep methodology: "0 source callers" as a delete signal requires the caller search to use the route's full path (all path segments present) in template-literal form, not a longest-static-suffix heuristic. Short static tails can be too non-unique to isolate the candidate, masking real callers behind sibling-route noise. Verified 2026-04-22 when Fix A's initial audit reported `uploads/route.ts` as 0-caller; exhaustive follow-up verification found a live UI caller via template-literal construction (`/api/deals/${safeDealId}/uploads` in `UploadBox.tsx:294`) that the longest-static-tail pattern (`/api/deals/` — 14 chars, matched hundreds of sibling routes) missed. Any future audit or Fix B lint rule must grep for `/api/.../<last-static-segment>` with dynamic-segment placeholders, or require a minimum static-tail length of ~18 chars before trusting the 0-caller result. (FIX-A follow-up lesson, AAR 2026-04-22)**
- **MCP integration contracts are sourced from the deployed service's `tools/list`, not from in-repo source code.** Services with independent release cycles (Cloud Run deployments, Pulse MCP, Buddy voice gateway) drift from repo skeletons. The authoritative contract is what the running service currently exposes. Verified 2026-04-23: rev 2 of the OMEGA-REPAIR spec named tools from in-repo source and would have kept the 100% failure rate; deployed `tools/list` reveals different tool names (`buddy_ledger_write`, not `buddy_write_ledger_event`). Rule: any MCP client work MUST `POST /{method:"tools/list"}` against the live service and record the actual tool names and schemas before mapping client code. (OMEGA-REPAIR rev 3.3)
- **Stop-and-surface is load-bearing.** Six moments in the Pulse/Omega arc (D3 pushback → diagnostic; Phase 2 probe → falsified black-hole; rev 2 execution → caught wrong tool names; rev 3 PIV → caught unrunnable PIV-3 and unmapped health URI; rev 3.1 PIV-3 probe → caught Pulse-side auth inconsistency; rev 3.2 PIV → caught field-name mismatch) were only caught because someone stopped partway and surfaced. Cost of another pass is hours; cost of shipping the wrong change is days. Rule: whenever execution evidence contradicts the spec, stop and surface before continuing. Applies to Claude, Claude Code, and any future contributor. (OMEGA-REPAIR rev 3.3)
- **`deal_gap_queue` requires `bank_id` and `fact_type` (both NOT NULL) and has a real, non-partial UNIQUE constraint on `(deal_id, fact_type, fact_key, gap_type, status)`.** This matches the table's own migration file but diverged from at least one already-shipped writer (`staleSignatureChecker.ts`, ARC-00 Phase 2) that omitted both columns and used plain `.insert()` — which would fail every call against real prod (NOT NULL) and throw on any re-run against a still-open gap (UNIQUE). Any code writing to `deal_gap_queue` on a repeating cadence (a cron job, not a one-shot user action) must `.upsert(rows, { onConflict: "deal_id,fact_type,fact_key,gap_type,status" })`, not `.insert()`. Caught and fixed when the checker was actually wired into a live cron for the first time (ARC-00 Phase 6C) — a library function with tests can still hide a schema-shape bug until something calls it repeatedly against real data.
- **pgcrypto's functions (`pgp_sym_encrypt`/`pgp_sym_decrypt`) live in the `extensions` schema on this Supabase project, not `public`.** Any `SECURITY DEFINER` function calling them needs `SET search_path = public, extensions` — `SET search_path = public` alone produces `function pgp_sym_decrypt(bytea, text) does not exist`. Standard Supabase convention; confirmed via `pg_proc`/`pg_namespace` during ARC-00 Phase 6B.
- **Parallel, independently-evolved legacy subsystems for the same conceptual feature are a recurring pattern in this codebase, not a one-off.** ARC-00 found three separate examples across its 6 phases: a triple SBA-eligibility-engine split (`src/lib/sba/eligibility.ts` / `eligibilityEngine.ts` / `src/lib/sba7a/eligibility.ts`), a generic `fillEngine`-based package generator alongside per-form `buildWithSignature`+`render` modules, and a dead/non-functional `/api/deals/[dealId]/etran/submit` route (`sba_form_payloads`/legacy `etran_submissions`) alongside the real E-Tran submitter. Standing disposition: do not reconcile/merge — build the new subsystem cleanly alongside, route around collisions (rename tables, use new/different route paths, extend an existing action-dispatch route), and log the discovery. Reconciliation is a separate, larger-scoped effort with its own spec.
- **A permanent human-approval gate for any regulator-facing submission (SBA E-Tran, and by extension anything with similar stakes) must be enforced at the function signature, not just the caller.** `submitToSba()` (ARC-00 Phase 6B) takes `approvedByUserId` as a required non-optional string, defense-in-depth-checks it's non-empty even though the caller already gates on an authenticated session, and the API route derives it exclusively from `ensureDealBankAccess`'s resolved `userId` — never from request body. There is no "auto-submit when ready" flag, env var, or cron path anywhere in this arc. (SR 11-7 wall.)
- **MCP JSON-RPC envelope is `tools/call`, not custom method names.** When integrating Buddy with any MCP server, the client speaks `method: "tools/call"` with `params: {name, arguments}`. Custom JSON-RPC method names (e.g., `omega://events/write`) are not recognized by any MCP server — they are an anti-pattern from early prototyping. Auth for tool calls is `x-pulse-mcp-key`; `Authorization: Bearer` is for the `/ingest/buddy` path only. `target_user_id` is optional in Pulse tool schemas (server injects default) — pass it for explicit multi-tenant hygiene but it is not a blocker. (OMEGA-REPAIR rev 3.3)
- **Vercel's `env pull` returns empty values for Sensitive-flagged env vars by design.** PIV procedures that need the actual secret value cannot rely on `env pull` for Sensitive vars — the file is created, the key name is present, the value is blank. Options: manual out-of-band probe (operator pastes the value in their own shell), Vercel REST API with a token that has Sensitive-read scope, or a diagnostic endpoint that reads `process.env.VAR` server-side and returns `{ present: boolean, length: number }` without echoing the value. Confirmed via Vercel docs 2026-04-23 during OMEGA-REPAIR rev 3.1 → rev 3.2 transition. (OMEGA-REPAIR rev 3.3)
- **Diminishing-returns rule for cross-system auth diagnostics.** When a diagnostic loop has exhausted 3+ rounds of chat-based probing without resolution, stop probing and defer to production verification. Reasoning: (a) the remaining variables are typically outside chat's visibility (network path, IP allowlist, protocol handshake differences, deployed-code drift); (b) code correctness and auth correctness are separable concerns that do not need to be verified in the same workstream; (c) production ledger signal is more authoritative than any out-of-band probe and is achievable for free by deploying the code fix. Rule: if PIV is looping, mark as deferred, ship the code, and let the ledger tell the truth. Demonstrated in OMEGA-REPAIR rev 3.1 → rev 3.2 (Pulse-side auth state confirmed inconsistent during manual probe; resolution deferred to Batch 4 ledger check). (OMEGA-REPAIR rev 3.3)
- **Tool-name mapping is necessary but not sufficient; field-name mapping is the second layer.** When integrating with an external tool, verifying the tool NAME exists in `tools/list` is table-stakes. The second required check is: does the caller's payload shape match the tool's `inputSchema` field-by-field? Tool-name match + field-name mismatch produces Zod errors at runtime — different error shape from "tool not found" but equally fatal. OMEGA-REPAIR rev 3.2 would have shipped with the correct tool name (`buddy_ledger_write`) and wrong field names (`type` instead of `event_type`, no `status`, no extracted `deal_id`); rev 3.3 caught this during PIV. Rule: when writing the translator/adapter layer, explicitly enumerate the required and optional fields from the tool's `inputSchema` and map caller data into them field-by-field. Do not spread caller objects into tool arguments without matching field names first. (OMEGA-REPAIR rev 3.3)

---

## Phase 84 ✅ — System Audit Remediation (closing)

10-ticket phase closing 37 audit findings across 4 waves. RLS batch A, document classifier fix, observer dedup audit, runRecord wiring, checklist taxonomy audit, idempotency guard, narrow Omega fallback, governance writers audit, env/roadmap reconciliation, repo hygiene.

See `docs/archive/phase-84/` for per-ticket AARs and audit docs.

**Meta-finding:** zero non-test deals in production database — flagged as **T-08-G** (top of Phase 84.1 backlog) for product/sales clarification before prioritizing further governance build work.

**Wave 1 lesson:** T-02, T-03, T-06 all had partial existing-state fixes shipped between spec drafting and execution. "Stop the bleeding" tickets have a structural risk of being already-fixed by the time they queue. Pre-work earns its keep.

---

## Phase 85 ✅ — ARC-00: SBA Forms Complete (7 phases, Gate 0 → Gate 6)

7-phase build arc (`specs/sba-30min-package/ARC-00-forms-complete-build-arc.md`) making Buddy generate/fill/e-sign/store/package every SBA borrower-facing form for 7(a) and 504 lending. Sequential phases with hard prod-verified gates (AP-1); schema verified against `information_schema`/`pg_constraint` before every migration (AP-3); missing/vendor-blocked fields flow to `deal_gap_queue`, never fabricated defaults (AP-5).

**Phase 0 (S1):** policy rule engine schema repair, Form 1920 deleted (SBA-eliminated form), official SBA template ingestion pipeline (infra-ready, blocked on network access to sba.gov), Form 159 real payload.

**Phase 1-2 (S2/S3):** deal-centric data builder + eligibility engine, Plaid integration, Forms 1919 (~80 fields) and 413 (PFS) full fielding, Persona IAL2 identity verification, DocuSeal e-signature, staleness checker.

**Phase 3 (S4):** soft-pull credit bureau, CAIVRS + SAM.gov federal debt screening, Forms 912/4506-C/155, IRS transcript submission + polling + reconciliation, equity seasoning + debt schedule auto-builders, real per-form PDF dispatch layer (`sbaFormDispatch.ts`) replacing the legacy generic `fillEngine`.

**Phase 4 (504 track):** 504 project-cost schema, Form 1244, 912/1244 parity.

**Phase 5 (closing + assembly):** Forms 148/148L (unconditional vs limited guarantee), 601 (construction >$10K), 722 (compliance acknowledgment, not fillable), 10-tab lender-ready package assembly (pdf-lib merge).

**Phase 6 (S5 — third-party + E-Tran):** third-party vendor order orchestration (appraisals, valuations, environmental, insurance, title, UCC — trigger rules + email dispatch), real SBA E-Tran submission with encrypted-at-rest mutual-TLS credentials (`bank_etran_credentials`, pgcrypto via `SECURITY DEFINER` RPCs) and a **permanent human-approval gate** (`approvedByUserId` required, sourced only from an authenticated session — no auto-submit path anywhere), bank-admin credential UI, 4 cron checks (IRS transcript polling, signature staleness, third-party order overdue, E-Tran cert expiry — consolidated into one `/api/cron/sba-checks?check=` route to protect the route/page slot budget).

**Environmental blockers (not code gaps — see Drift Log for full list):** no live SBA/IRS network access, no Persona/DocuSeal/CAIVRS/SAM/E-Tran vendor credentials provisioned in this environment, no GCP/Cloud Run access for DocuSeal deployment, no fully-populated SBA smoke deal in prod for live end-to-end verification, `deal_truth_snapshots` missing the `truth`/`version` columns every consumer (including this arc's own `generateETranXML`) expects — a separate, larger truth-snapshot-writer effort.

See `specs/sba-30min-package/ARC-00-forms-complete-build-arc.md`'s Drift Log for the full list of schema-drift findings, parallel-legacy-subsystem discoveries, and scoped-out follow-ups. Per-phase gate docs: `docs/build-logs/ARC00_PHASE_{0,1,2,3,4,5}_GATE.md`, `docs/build-logs/ARC00_COMPLETE.md` (Gate 6 / arc-end verification).

---

## SPEC-BROKERAGE-SBA-READY-V1 — Closing the Gap to a Complete Borrower Experience (2026-07)

Ticket 0 (mandatory audit-first gate) + Ticket 1 (new-business protocol wiring) closed. See `docs/archive/brokerage-sba-ready-v1/` for T0-findings.md and T1-AAR.md.

**T0 findings, in brief:**
- Equity injection floor in `newBusinessProtocol.ts` was **20%, should be 10%** per current SOP 50 10 8 (eff. 2025-06-01) — fixed. Found and fixed the *same* wrong 20% figure duplicated a second time in `sbaAssumptionCoach.ts`.
- Bigger, unasked-for finding: `dealDataBuilder.ts`'s `ELIGIBLE_CITIZENSHIP_STATUSES` still treats lawful permanent residents as eligible owners — **wrong since 2026-03-01** per SBA Procedural Notice 5000-876626, which categorically excludes LPRs. Fixed (removed LPR from the eligible set); a live compliance gap that had nothing to do with the "Principal Residence" question T0 was actually asked to check. A distinct `principal_residence_in_us`-style certification field is still missing and is recommended as the single highest-priority follow-up ticket.
- Confirmed the Brokerage concierge does write `YEARS_IN_BUSINESS` into `deal_financial_facts` today, so Ticket 1's wiring is not a no-op.
- Confirmed the Buddy SBA Score itself was never affected by the `isNewBusiness: false` bug — `sbaRiskProfile.ts` already wired new-business detection correctly. The bug was isolated to the Feasibility Study engine (`feasibilityEngine.ts`).
- Confirmed `debtScheduleAutoBuilder.ts` (existing-business-debt capture) exists, is tested, and has **zero production callers anywhere** — Plaid-driven, not document-extraction-driven as speculated. Brokerage borrowers currently have no path (conversational, Plaid, or manual) to submit existing business debt. Flagged as a T3-adjacent follow-up.

**T1:** wired `detectNewBusinessFromFacts`/`assessNewBusinessRisk` into `feasibilityEngine.ts` in place of the hardcoded `isNewBusiness: false`; threaded the real `equityInjectionFloor`/`projectedDscrThreshold` into `financialViabilityAnalysis.ts` (removing a second hardcoded 20%/1.25x copy that existed there); new-business blockers/warnings/narrative now surface into the feasibility study's flags (read by the Gemini narrative prompt) so a start-up's study reads differently, not just scores differently. New unit tests: `newBusinessProtocol.test.ts`, `financialViabilityAnalysis.test.ts` (quarantined from default `test:unit` — same `server-only`-under-`node --test` issue as `computeNextStep.test.ts`; passes under `node --conditions=react-server --test`). Full `pnpm test:unit` (11,545 tests) and `tsc --noEmit` clean after all changes.

**Two follow-up tickets filed out of T0's findings (2026-07-14), confirmed by product as real work items, not just observations:**
- **Principal Residence certification** (`specs/follow-ups/SPEC-BROKERAGE-SBA-READY-V1-principal-residence-certification.md`) — P0, **open**. T0's highest-priority follow-up: SBA Procedural Notice 5000-876626 (eff. 2026-03-01) requires every owner's principal residence be in the US/its territories, separate from citizenship status. Only the LPR-ineligibility half of this notice was fixed in T1; this closes the other half, which currently has no field or eligibility check at all.
- **Existing business debt capture** (`specs/follow-ups/SPEC-BROKERAGE-SBA-READY-V1-debt-schedule-wiring.md`) — P0, **sequenced ahead of Ticket 2 (identity/e-sign), mostly closed 2026-07-14 (same day, second pass).** Confirmed Brokerage has no live Plaid connection today. Everything buildable without it shipped: a shared `deal_existing_debt_schedule` writer used by both a new Brokerage borrower-facing route and the refactored banker-facing one; a Plaid-drop-in adapter (`debtScheduleEntryToRow`) plus `source`/`confidence` columns so a future auto-builder needs no further migration; and — the part T0 didn't catch — a bridge fixing a *third* disconnected existing-debt representation (`buddy_sba_assumptions.loan_impact.existingDebt`, previously fabricated from a bare `ADS` fact and never replaceable once empty, due to a `[] ?? x` nullish-coalescing gap in `sbaAssumptionsBootstrap.ts`) that actually drives the Brokerage SBA package's DSCR, separate from the Underwriter-cockpit pipeline that already read the table directly. New borrower-facing `ExistingDebtCard` UI, including an explicit "no other business debt" confirmation. Live Plaid Link integration itself remains open, gated on vendor credentials (same category as ARC-00's other unprovisioned integrations). Full writeup: `docs/archive/brokerage-sba-ready-v1/T1b-AAR.md`.

**finengine single-source-of-truth pass (2026-07-14, third pass same day)** — directive: "Buddy should have only one source of truth for financial calculations and that is the FinEngine." A verification pass earlier the same day found the entire Brokerage SBA stack had zero finengine imports; this pass closed that gap for every credit-policy *value* (DSCR floor, equity-injection minimum). Found the hardcoded DSCR threshold (1.25) independently duplicated in **nine separate files** — `newBusinessProtocol.ts`, `financialViabilityAnalysis.ts`, `sbaSourcesAndUses.ts`, `sbaForwardModelBuilder.ts`, `sbaPackageOrchestrator.ts` (which also had its own separate, non-canonical `isNewBusiness` detector), `sbaGlobalCashFlow.ts`, `sbaPackageRenderer.ts` (the lender-facing PDF, 8 sites), `sbaBorrowerPDFRenderer.ts` (the borrower-facing PDF), and `ProjectionDashboard.tsx` (the live client dashboard) — several silently applying the *new-business* 1.25x standard to *established* businesses that only need 1.10-1.20x depending on loan size. Extended finengine's `PolicyContext`/`dscr_floor` axis to model business age (additive, non-breaking — 6 new registry tests), then migrated every one of those nine sites to resolve from the registry instead of a local constant, fixing the live established-business bug in the process, not just relocating the hardcode. Deliberately left out of scope: general educational glossary copy (`sbaConceptExplainer.ts`), the forward model's non-DSCR projection math, and the Buddy SBA Score's composite scoring curves (a different kind of calculation finengine has no equivalent for). `tsc` clean and full `pnpm test:unit` (11,565 tests) green throughout. Full writeup: `docs/archive/brokerage-sba-ready-v1/T3-finengine-single-source-of-truth-AAR.md`.

**Principal Residence certification — closed 2026-07-15.** Additive `ownership_entities.principal_residence_in_us` column; `BORROWER_FIELD_REGISTRY` entry (concierge capture + propagation to the DB wired for free, registry-driven, zero extra code); `dealDataBuilder.ts`'s `allOwnersCitizenshipEligible` now gates on it (false/null/true with the same fails-closed convention as citizenship_status); mirrored into finengine's not-yet-live `sba/eligibility.ts` so it doesn't regress on cutover. Certification language in the e-sign ceremony itself is deferred to Ticket 2, which doesn't exist yet. Full writeup: `docs/archive/brokerage-sba-ready-v1/T4-principal-residence-and-xlsx-AAR.md`.

**Ticket 5 (Projections XLSX real tables) — closed 2026-07-15.** Sources & Uses and Balance Sheet tabs rebuilt as real rows/columns with live formulas (SUM, IF-based ratio/pass-fail checks) instead of a JSON-in-a-cell dump. Caught and fixed a real crash bug along the way: the original implementation didn't defensively handle legacy `buddy_sba_packages` rows where these columns are `{}` placeholders rather than `null` or the real shape — would have taken down bundle generation for those deals. Visual sample delivered to the user for inspection, per the ticket's own "not just a passing test" verification bar. Same AAR as above.

**Ticket 2 (identity/e-sign) — identity verification closed, e-signature UI deferred, 2026-07-15.** No written spec existed for this ticket going in. Research confirmed the ARC-00 Persona/DocuSeal libraries (`identity/kyc/service.ts`, `esign/docuseal/service.ts`, including the IAL2-gates-signing hard gate) are tenant-agnostic, but the Underwriter-tenant routes exposing them are Clerk+bank-membership gated — unusable by a Brokerage borrower's cookie session. Shipped: a new consolidated `/api/brokerage/deals/[dealId]/identity/[action]` dispatcher (kyc+esign in one file — two separate files would have tipped the route-count warning threshold from 1902 to 1904/1904, so they were merged the same way `model-v2`/`research` already are, rather than bumping the budget; **later renamed to `.../borrower-actions/[action]`** when the forms-generation follow-up below needed a home in the same file); a shared `ownersNeedingIal2` helper wired into `canSeal()` as a new gate (every owner at/above the 20% ownership threshold must complete IAL2 before sealing); a borrower-facing `IdentityVerificationCard` on `/start`. Documented default decision (no spec existed to consult, so a reasoned default was built and flagged for override): identity verification gates sealing; e-signature of the actual SBA forms happens after the borrower picks a lender, not before. E-signature's UI is deliberately **not** built yet — confirmed Brokerage has zero per-owner SBA form generation (no `sbaFormDispatch`/`FORM_1919`/`FORM_413` callers anywhere under `src/lib/brokerage/`), so a signing grid would have nothing real to sign; the API route is generic on `form_code` and ready the moment that pipeline exists. `tsc` clean, full `pnpm test:unit` 11,577 passed (up from 11,568; 9 new tests). Full writeup: `docs/archive/brokerage-sba-ready-v1/T5-ticket2-identity-esign-AAR.md`.

**Ticket 4 (score framing) — audit portion closed, 2026-07-15; the wording/positioning decision itself remains Matt's.** Four-agent sweep across ~90 borrower-facing UI components, scoring logic, PDF/narrative renderers, and concierge/marketing copy found **no string anywhere that states a specific probability, percentage, or odds of loan approval** — and found the codebase already enforces this via `FORBIDDEN_BORROWER_TERMS` (`borrowerSafeCopy.ts`) plus ~15 CI-enforced regression tests asserting phrases like "approval odds"/"guaranteed funding" never appear in rendered output. One real gap found and flagged (not fixed — a product call, not a bug fix): `src/lib/sba/difficulty.ts`, a legacy parallel scorer whose own doc comment frames its percentage as something that will "unlock approval," live behind an API route with no confirmed frontend caller. Several borderline inconsistencies also catalogued (components missing the "not approval likelihood" hedge that sibling components carry). Full findings + recommendations for Matt: `docs/archive/brokerage-sba-ready-v1/T6-ticket4-score-framing-audit.md`.

**Brokerage per-owner SBA form generation — closed 2026-07-15 (Ticket 2 follow-up).** Reused the Underwriter tenant's `prepareSbaPackage`/`generatePdfForFillRun`/`assembleTenTabPackage` pipeline unchanged (all already pure `(dealId, bankId, sb)` functions) via a new `src/lib/brokerage/borrowerFormsOrchestration.ts` layer, exposed as four new actions (`prepare-forms`, `forms-status`, `generate-forms`, `assemble-forms`) folded into the same `borrower-actions/[action]` dispatcher Ticket 2 built — a second new route file would have re-tipped the 1902/1904 slot budget. Auto-triggers (best-effort, prepare only, not render) right after a borrower picks a lender in `marketplace/pick/route.ts`. Nuance discovered while building this: DocuSeal e-signature doesn't actually depend on this pipeline — it signs against its own pre-configured template per form code, entirely separate from these filled reference PDFs — so this specifically unblocks the lender-facing 10-tab package, not the signing ceremony itself; the earlier Ticket 2 AAR's framing was imprecise on that point. **Real, pre-existing, tenant-independent blocker, not introduced here:** official SBA/IRS PDF templates were never ingested into this environment (`public/sba-templates/` doesn't exist), so every render call returns `TEMPLATE_NOT_AVAILABLE` until `scripts/ingest-sba-templates.ts` runs somewhere with sba.gov/irs.gov network access — same class of gap as ARC-00 Phase 0's own documented blocker. Also flagged, not fixed: unconfirmed whether Brokerage intake populates `borrower_applicant_financials` (Form 413's data source), and 4506-C/Form 155 resolve their recipient/lender name from `banks.name`, which reads "Buddy Brokerage" rather than the eventual picked lender for a Brokerage deal — a product decision, not a bug. `tsc` clean, full `pnpm test:unit` 11,587 passed (up from 11,577; 10 new tests); route count unchanged at 765. Full writeup: `docs/archive/brokerage-sba-ready-v1/T7-brokerage-form-generation-AAR.md`.

**Two live bugs found and fixed, 2026-07-15** — following up on T7's own flagged "worth checking, not fixed" items. (1) The four other dispatched forms (4506-C, 155, 148/148L, 601) had the same "prints Buddy Brokerage instead of the picked lender" issue Form 159 already had a fix for — new `resolveEffectiveLenderBankId.ts` (checks `marketplace_picks`, falls back to `deals.bank_id`) wired into the single choke point (`generatePdfForFillRun.ts`) all four flow through, fixing all at once. (2) Confirmed live and fixed: Brokerage's PFS capture (`borrower_applicant_financials`) has been silently broken since it shipped — its FK pointed at an unrelated legacy table (`borrower_applicants`) nothing in Brokerage ever writes to, so every insert from the concierge/voice writer has failed since day one (verified: 15 `ownership_entities` rows exist, 0 `borrower_applicant_financials` rows exist). Migration re-points the FK at `ownership_entities(id)`, matching every real caller. Second-order bug also fixed: `buildSealedSnapshot.ts` — the function that assembles what lenders see at seal time — queried this table by a `deal_id` column that doesn't exist, so every sealed Brokerage listing's `fico_score`/`liquid_assets`/`net_worth` has always shown null regardless of what the borrower actually provided; now resolves through the deal's primary owner correctly. `tsc` clean, full `pnpm test:unit` 11,589 passed (up from 11,587; 2 new tests). Full writeup: `docs/archive/brokerage-sba-ready-v1/T8-two-live-bugs-AAR.md`.

**Mock Persona/DocuSeal vendor harness — closed 2026-07-15**, to unblock a full E2E walkthrough despite neither vendor being provisioned. Design principle: fake the vendor HTTP call, never the business logic — the IAL2-gates-signing hard gate, the real webhook completion handlers (`handlePersonaWebhook`/`handleDocusealWebhook`), and every real DB write/storage upload all still run; only `createPersonaInquiry`/`fetchPersonaInquiry`/DocuSeal's fetch-and-download calls are faked. Double-gated behind `BUDDY_MOCK_VENDORS === "true"` **and** `NODE_ENV !== "production"` (either check alone is a single point of failure), and every mock DB row is tagged `vendor: "mock_persona"` (new migration extends the CHECK constraint) so a fake verification can never be mistaken for a real one. New `SigningPanel.tsx` also shipped — a real (not mock-only) borrower-facing e-sign trigger, since the corrected T7 understanding (DocuSeal signs against its own pre-configured template, not a generated reference PDF) means this never actually depended on the still-missing SBA form-generation pipeline. Verified with an integration test chaining the real functions in borrower-triggered order (initiate → blocked pre-verification → verify → sign → complete → `signed_documents` written with full audit trail), not just isolated per-module tests. `tsc` clean, full `pnpm test:unit` 11,604 passed (up from 11,589; 15 new tests). Full writeup: `docs/archive/brokerage-sba-ready-v1/T9-mock-vendor-harness-AAR.md`.

**Recurring SBA/IRS template staleness checker — closed 2026-07-16.** User asked to ingest all necessary SBA forms; network access to sba.gov/irs.gov is still blocked (confirmed a third time — directly running `scripts/ingest-sba-templates.ts` itself hits the identical 403 as the earlier `curl`/WebFetch checks), so the user opted to fix the environment's network policy directly rather than route around it ("to ensure our documents are always the latest and not stale"). Built the piece that keeps them that way once ingestion happens: extracted the ingestion script's source-list + fetch/hash logic into shared modules (`src/lib/sba/templates/`) so a new recurring job, `findTemplateStaleness`/`writeTemplateStalenessFindings` (`src/lib/jobs/templateStalenessChecker.ts`), compares live sha256 against stored `bank_document_templates` rows using the identical resolution logic the ingester itself uses — a checker with even slightly different logic than the ingester could flag false staleness forever. Wired in as `check=template-staleness` on the existing consolidated `/api/cron/sba-checks` route (weekly, Mondays — no new route file) plus a `vercel.json` cron entry. **Real bug found and fixed while refactoring, not just plumbing:** the ingestion script's PDF-link regex was hardcoded to `sba.gov` only, so `IRS_4506C` (an irs.gov source page) could never have resolved even with working network access — invisible until now since this environment has never had working access to either domain to notice. Fixed and covered by a dedicated regression test. Migration adds `last_checked_at`/`is_stale` tracking columns to `bank_document_templates` (applied live). Deliberately not done: wiring `is_stale` into the actual PDF renderers to refuse stale forms — a bigger, riskier behavior change than record-and-log, left as a follow-up once the checker's signal is trusted. `tsc` clean, full `pnpm test:unit` 11,614 passed (up from 11,604; 10 new tests). Full writeup: `docs/archive/brokerage-sba-ready-v1/T10-template-staleness-checker-AAR.md`.

Remaining open tickets from the original spec, in updated priority order: **live Plaid Link for the debt-schedule auto-builder** (P0, credential-gated — blocked, no vendor credentials in this environment) → official SBA/IRS PDF template ingestion (blocked on this environment's network policy — user is updating it directly; once done, both the one-off ingestion script and the new recurring staleness checker work unattended, no further code needed) → real Persona/DocuSeal vendor provisioning (needed once the mock harness's job — proving the flow works — is done and this needs to go live) → Ticket 4's framing decision (Matt) → Ticket 6 (lender blind-review doc, needs Matt's decision — explicitly "decide, not build") → Ticket 8 (end-to-end synthetic run, closing ticket — now unblocked for testing via the mock harness, still blocked for a real production run on the same vendor credentials as Plaid/DocuSeal/Persona). Ticket 7 (marketplace liquidity) is explicitly not a code ticket. Separately open, flagged during the finengine pass: wholesale migration of the SBA forward model's projection math onto finengine's `CashFlowMethod`/`projectionEngine` interfaces — a larger architectural project, not started.

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
- ~~**D2 (external) — Omega Prime MCP returns `Method not found` for all four resources Buddy calls.**~~ **RESOLVED 2026-04-23 via OMEGA-REPAIR.** Original attribution ("Buddy side correct; external") was wrong — rev 3 spec discovery walked back through three revisions until rev 3.3's PIV caught all three Buddy-side bugs (wire method, auth header, write-path field mapping). Commits aa4ded8a + 7d0550a5.
- **D3 (ledger pollution) — Fastlane Pulse forwarder emits degraded signals for missing config.** `PULSE_MCP_ENABLED` not set in Vercel; `pulse.forwarding_failed: pulse_mcp_disabled` fires on every checklist tick. Batch forwarder (separate env vars) confirmed working. Spec drafted (`specs/aar-2026-04-22-test-pack-run-1/spec-d3-fastlane-pulse-silence.md`).
- **D4 (one-off) — Single POST 500 on cockpit first load.** Sub-route truncated in Vercel logs. Was likely Omega-coupled (D2); with D2 now resolved, re-observe on next cockpit load to confirm D4 goes away or persists independently.
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

## SPEC-FOUNDATION-V1 — Bullet-proof Underwriting Foundation (2026-05)

**SPEC-FOUNDATION-V1 PR1 — Orphaned principal_bio override rekey** (shipped 2026-05-08, merge commit `96c744c9`)
- A-1 forward fix: `migrateLegacyOverridesAsync.ts` captures `legacyPrincipalId → canonicalPrincipalId` map and rewrites `principal_bio_{legacyId}` → `principal_bio_{canonicalId}` in `deal_memo_overrides` in the same transaction. UUID_RE filter preserves non-UUID keys (e.g. `principal_bio_general`).
- A-2 telemetry: `memo_input.legacy_migration` audit event extended with `override_keys_rewritten` + `orphaned_override_keys`.
- A-3 backfill: `scripts/foundation-pr1-rekey-principal-bios.ts` executed against 4 SPEC-13.5 deals 2026-05-08:
  - Samaritus (`0279ed32`): 1 key rekeyed (MICHAEL NEWMARK), audit event `34b6c445-5349-4b8d-800b-fcaaa68bbaa3` written.
  - OmniCare May 1 (`80fe6f7a`): no-op (only `principal_bio_general` present, non-UUID suffix correctly skipped).
  - OmniCare Review (`0d31ebf3`): 2 orphans flagged (duplicate "Matt Hunt" canonical profiles → ambiguous match → preserved). Filed: `specs/follow-ups/SPEC-FOUNDATION-V1-PR1-omnicare-review-matt-hunt-duplicates.md` (commit `888d48b0`). Deferred — stage `collecting`.
  - Test Pack #1 (`e505cd1c`): no-op (no `principal_bio_%` keys).
- A-4 CI guard: 8 source-level tests pinning rekey logic + script contract.
- Status: management_bio gate clears for Samaritus (verified via PR2's V-8).
- Next blockers: PR2 (collateral_value), PR3 (T12 audit), PR4 (dscr_computed via cash flow aggregator).

---

## Next Phases (priority order)

1. **Ship D1 + D3** (Test Pack Run 1 blockers, specs drafted 2026-04-22). Tight, shippable. Unblocks continuation of the banker-side test pack and fixes `deals.display_name` on every future deal.
2. **FIX-C enforcement flip — deferred.** Re-open when a T3 architectural cluster (builder/entities duplication, extract-twin consolidation, recompute duplication) lands and gives us ≥10 routes of cushion under the 2020 error threshold. Current state (2023 measured, 3 over threshold) is acceptable steady-state: `.github/workflows/route-budget.yml` is advisory, posts count + delta comments on every PR, and the count is below the 2048 Vercel cap with 25 routes of headroom. Enforcement is only valuable when the threshold can be held without false-positive blocking; we can't hold 2020 today without another round of architecture work. See `specs/fix-a-route-consolidation/AUDIT.md` Closing State for the full reasoning.
3. **Phase 84.1 backlog** — see `docs/archive/phase-84/` for generated tickets, including the gating **T-08-G** (production activity baseline). Until T-08-G is answered ("are there any live paying banks?"), the rest of 84.1 priority ordering is provisional. Tickets queued: T-08-A (recon rarity), T-08-C (executeCanonicalAction never invoked), T-08-E (wire analyst-correction UI), T-08-B/D/F (governance writers), RLS Batch B, fact re-parenting, `.update()/.insert()` silent-error audit. D2 (Omega `Method not found`) **closed** 2026-04-23 via OMEGA-REPAIR.
4. **Canonical Credit Memo Facts** — Replace `deal_memo_overrides` dependency for computed fields. Keep overrides only for qualitative banker-supplied narrative.
5. **Observability** — Activate fastlane telemetry if real-time Pulse visibility is desired (set `PULSE_MCP_ENABLED` + `PULSE_MCP_URL`). Batch forwarder already working. See D3 roadmap note.
6. **Model Engine V2** — Enable feature flag + seeding once observability exists.
7. **Borrower Intake** — Replace the stopgap wizard per core architecture.
8. **Corpus Expansion** — Needed for bank confidence and model quality.
9. **Fix B — Lint rule for sibling `/status` directories** (writable after 2-4 weeks of FIX-C data confirms that `/status` siblings are the dominant route-growth pattern).
10. **Pulse-side deal-scoped advisory tools (PULSE-SIDE-SPEC)** — ship `buddy_advisory_for_deal` / `buddy_confidence_for_deal` / `buddy_traces_for_deal` in PulseMasterrepo. Unblocks cockpit advisory visibility; Buddy's read path is currently kill-switched waiting on these. Small Buddy follow-up PR afterward (change 4 URI mappings, remove the kill-switch branch). See `specs/omega-repair/PULSE-SIDE-SPEC.md`.
11. **Pulse-side auth diagnostic (conditional on OMEGA-REPAIR Batch 4 outcome B)** — if post-deploy ledger shows `http_401` for writes/health, investigate why MCP-protocol calls (Claude's chat connector) authenticate with the same secret source that direct HTTP calls (Buddy's Vercel runtime, curl) reject. Candidates: protocol handshake differences, IP allowlist, Cloud Run ingress, deployed-code drift past `auth.ts`. Pulse-side workstream; Buddy's wire + field contract is already correct.

---

*The mission: a system that proves itself right before delivery —
so bankers focus entirely on credit judgment.*
