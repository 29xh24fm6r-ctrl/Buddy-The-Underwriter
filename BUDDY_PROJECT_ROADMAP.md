# Buddy The Underwriter — Project Roadmap
# Institutional-Grade Commercial Lending AI Platform

**Last Updated: March 2026**
**Status: Phase 49 complete — ownership_entities permanent fix, auto-create from 1040 OCR**

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
        ↓ Buddy Intelligence Engine (BIE)           ✅ Phase 35 + AARs 45/46 — LIVE
        ↓ Memo Completion Wizard (stopgap)          ✅ Phase 48 — LIVE
        ↓ Credit Memo (Florida Armory standard)     ✅ Phase 33
        ↓ Ownership Entity auto-creation            ✅ Phase 49 — from 1040 OCR
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

---

## Phase 49 — Ownership Entities Permanent Fix ✅ COMPLETE

### Root cause chain

Three compounding bugs caused "Pending — ownership entities required" to always show
in Management Qualifications:

1. **Column mismatch:** `buildCanonicalCreditMemo` referenced `o.name`, `o.legal_name`,
   `o.ownership_pct`, `o.title` — none of which exist in `ownership_entities`.
   The real column is `display_name`. This caused the query to return data
   but render every principal as "Unknown."

2. **Zero rows:** The extraction pipeline never created `ownership_entities` rows.
   The table existed and was queried, but no code wrote to it during document processing.

3. **Unstable bio key:** The wizard stored bios under
   `principal_bio_{name_slug}` (name-derived, collision-prone). The memo
   builder looked up by `principal_bio_{id}` (UUID). They never matched.

### Fixes applied (6 steps, tsc clean)

1. **DB migration** — Added `ownership_pct numeric` and `title text` columns to
   `ownership_entities` (additive, safe).

2. **`types.ts`** — Added `id: string` as first field in `principals` array type,
   threaded through all consumers.

3. **`buildCanonicalCreditMemo.ts`** — Three fixes:
   - Bio key now UUID-based: `principal_bio_${o.id}`
   - Name reads from `o.display_name` (correct column)
   - Guarantors and `life_insurance_insured` also use `o.display_name`

4. **`page.tsx`** — Wizard receives `p.id` (UUID) not name slug. Bio keys
   are now stable across renames.

5. **`extractFactsFromDocument.ts`** — Added `extractTaxpayerName()` +
   `ensureOwnerEntity()` helpers. Personal income (1040) and PFS extraction
   blocks now auto-create an `ownership_entities` row when no owner is
   assigned, using the taxpayer name parsed from OCR. The document is then
   assigned to that entity so future re-extractions reuse the same row.

6. **tsc clean** — No type errors.

### Permanent behavior going forward

When a 1040 is uploaded and processed:
1. OCR extracts taxpayer name from Form 1040 header
2. `ensureOwnerEntity()` upserts a row in `ownership_entities` (idempotent)
3. The document is linked to that entity via `assigned_owner_id`
4. `buildCanonicalCreditMemo` reads the entity, renders the principal in
   Management Qualifications with the correct name
5. Banker opens wizard → types bio under `principal_bio_<uuid>` → saves
6. Memo reload shows bio in Management Qualifications

---

## Current State — Active Deals

**Deal ffcc9733** — Samaritus Management LLC (primary active test deal)
- 9/9 docs. NET_INCOME = $204,096 (2025). ADS = $67,368. DSCR = 4.27x.
- ✅ AI Risk: BB+ grade, 975 bps
- ✅ BIE: LIVE — 9 memo subsections with Gemini-written content
- ✅ B&I Analysis: clean — BIE-priority, no BRE prefix, no SBA bleed
- ✅ Generate Narratives: unblocked
- ✅ Wizard: qualitative fields saved — business description, revenue mix,
  seasonality, collateral description all populated
- ✅ Ownership entities: column mismatch fixed, auto-create wired
- 🔴 Management bio: existing save was under old key (`principal_bio_general`);
  re-open wizard, retype Ialacci bio once under new UUID key
- 🔴 Reconciliation: `recon_status` NULL — blocks Committee signal

---

## Known Gaps — Priority Order

### P1 — Immediate

1. **Re-open wizard on Samaritus** — retype Ialacci bio (one-time, old key
   `principal_bio_general` is stale; new UUID key will persist permanently)
2. **Generate Narratives** — confirm Executive Summary and Borrower sections
   show Gemini prose after maxDuration fix
3. **Reconciliation** — `recon_status` NULL. Blocks Committee Approve signal.

### P2 — Near Term

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
| **Buddy Intelligence Engine** | **gemini-3.1-pro-preview** | **GEMINI_API_KEY (Dev API)** | **✅ LIVE — 9 sections rendering** |
| **Generate Narratives** | **Gemini Flash** | **GEMINI_API_KEY (Dev API)** | **✅ LIVE — maxDuration fixed** |
| chatAboutDeal | OpenAI gpt-4o-2024-08-06 | OpenAI API key | 🔴 Gemini migration queued (P3) |

---

## Definition of Done — God Tier

1–61. ✅ All prior phases and AARs complete through Phase 35 + AARs 45/46/47 + Phases 48/49.
62. 🔴 Ialacci bio retyped in wizard under UUID key — Management Qualifications complete
63. 🔴 Generate Narratives confirmed — Executive Summary shows Gemini prose
64. 🔴 Reconciliation complete — Committee Approve signal unlocked
65. 🔴 Borrower Intake wired — wizard deprecated, qualitative fields auto-populate
66. 🔴 Spread completeness ≥80%
67. 🔴 Banker experience — opens a spread, trusts every number, focuses on credit

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
- **`deal_memo_overrides` is a stopgap for qualitative memo fields (business description, seasonality, revenue mix, collateral description, principal bios). It will be deprecated when borrower intake auto-populates these fields. Never use it for numeric/computed fields — those must come from documents and facts only.**
- **The wizard must never ask bankers to manually enter numbers. Collateral values, LTV, DSCR, stressed DSCR come from documents and computation. The wizard is strictly for narrative qualitative fields that a banker knows from conversations and cannot be extracted.**
- **`ownership_entities` correct columns: `id`, `deal_id`, `entity_type`, `display_name`, `tax_id_last4`, `meta_json`, `confidence`, `evidence_json`, `created_at`, `ownership_pct`, `title`. Never reference `name`, `legal_name` — those don't exist. Always use `display_name`.**
- **Principal bio keys in `deal_memo_overrides` use UUID format: `principal_bio_<ownership_entity_uuid>`. Name-derived slugs (`principal_bio_joseph_ialacci`) are fragile — UUIDs are the contract.**
- **`ownership_entities` rows must be auto-created during personal doc extraction (1040, PFS) using `ensureOwnerEntity()`. Never assume a row exists — always upsert idempotently by `(deal_id, display_name)`.**
- **When a CSS context inherits a non-black text color (common in dark-mode-aware apps), always set `text-gray-900 bg-white` and `placeholder-gray-400` explicitly on every `<input>` and `<textarea>`. Omitting these causes white-on-white invisible text.**

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
| Phase 48A | Narratives route `maxDuration=60` — Generate Narratives was timing out | ✅ Complete | — |
| Phase 48B | Memo Completion Wizard — `deal_memo_overrides`, qualitative stopgap | ✅ Complete | — |
| **Phase 49** | **Ownership entities permanent fix — column mismatch, UUID bio keys, auto-create from 1040 OCR** | **✅ Complete** | **—** |
| Retype Ialacci bio | Re-open wizard, retype bio under new UUID key (one-time) | 🔴 Next | — |
| Generate Narratives | Confirm Gemini prose in Executive Summary + Borrower sections | 🔴 Next | — |
| Reconciliation | `recon_status` — Committee Approve signal | 🔴 Active | — |
| Borrower Intake | Voice interview + forms → auto-populate memo (replaces wizard) | 🔴 Queued | — |
| Model Engine V2 | Feature flag + seeding + wiring | 🔴 Queued | — |
| Observability | Telemetry pipeline activation | 🔴 Queued | — |
| Corpus Expansion | 10+ verified docs across industries | 🔴 Queued | — |

---

*The mission: a system that proves itself right before delivery —
so bankers focus entirely on credit judgment.*
