# Buddy The Underwriter — Project Roadmap
# Institutional-Grade Commercial Lending AI Platform

**Last Updated: March 2026**
**Status: Phase 48 spec complete — Memo Completion Wizard (stopgap) + narratives route maxDuration fix**

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
        ↓ Memo Completion Wizard (stopgap)          🔴 Phase 48 — spec ready
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
### AAR 38 ✅ — Bridge → PDF route + `supabaseAdmin` in runMission
### AAR 39 ✅ — Bridge IIFE → awaited before response (a8915d9c)
### AAR 40 ✅ — `maxDuration=60` + direct upsert bridge, permanent (ce786ce1)
### AAR 41 ✅ — Research error logging + conditional SBA eligibility (ee38ec31)
### AAR 42 ✅ — Research UUID fix + AI risk grade from result_json
### AAR 43 ✅ — `raw_content` nullable + explicit null fallback
### AAR 44 ✅ — Research section title mismatch fixed, B&I Analysis populates
### Phase 35 ✅ — Buddy Intelligence Engine built (7 threads, Google Search grounding)
### AAR 45 ✅ — Research deduplication (.limit(1)) + SBA language fix
### AAR 46 ✅ — BIE content priority (extractBIESection) + management per-sentence fix
### AAR 47 ✅ — Personal income spread key mismatch fixed

---

## Phase 48 — Memo Completion Wizard + Narratives Route Fix 🔴 SPEC READY

### Part A — Narratives route `maxDuration` fix (1 line, immediate)

**File:** `src/app/api/deals/[dealId]/credit-memo/canonical/narratives/route.ts`

Add after imports, before `export async function POST`:
```ts
export const runtime = "nodejs";
export const maxDuration = 60;
```

The route was missing this guard — Vercel kills it at the platform default (10–15s)
before `buildCanonicalCreditMemo` + Gemini call can complete. This is why
"Generate Narratives" appeared to do nothing.

---

### Part B — Memo Completion Wizard (stopgap for qualitative fields)

**Architectural context:** This wizard is explicitly a stopgap. The qualitative
fields it collects (`business_description`, `seasonality`, `revenue_mix`,
`collateral_description`, principal bios) will eventually flow automatically
from the borrower intake process (voice interview + intake forms). When that is
built, `deal_memo_overrides` can be deprecated with zero impact — it's a thin
isolated layer that only `buildCanonicalCreditMemo` reads from.

The wizard intentionally does NOT ask bankers to manually enter numbers
(collateral values, LTV, DSCR). Those come from documents and computation only.
It only collects what a banker genuinely knows that cannot be extracted.

**What the wizard collects:**

| Field | Why wizard, not document |
|---|---|
| Business Operations / History | Narrative — borrower tells banker, not in any doc |
| Revenue Mix | Qualitative breakdown — not in financial statements |
| Seasonality | Operational context — banker knows from intake conversation |
| Collateral Description | Prose description — not in appraisal as structured text |
| Principal Bios | Management background — borrower interview only |

**What the wizard shows as action items (not input fields):**

Any `missing_metrics` from the memo readiness check (collateral values, LTV,
DSCR, stressed DSCR) — these need documents uploaded, not manual entry.

**Deliverables for Antigravity:**

1. **DB migration** — `deal_memo_overrides` table with `(deal_id, bank_id)` unique constraint, RLS enabled
2. **New API route** — `src/app/api/deals/[dealId]/credit-memo/overrides/route.ts` (GET + POST, `maxDuration=15`)
3. **Modify `buildCanonicalCreditMemo.ts`** — add `deal_memo_overrides` to the parallel query block; apply `overrides.business_description`, `overrides.revenue_mix`, `overrides.seasonality`, `overrides.collateral_description`, `overrides.principal_bio_{ownerId}` when present
4. **New component** — `src/components/creditMemo/MemoCompletionWizard.tsx` — modal with three sections: Business Profile (description, revenue mix, seasonality), Collateral Description, Management Bios (one textarea per principal); saves to overrides API, reloads page on success; shows document-gap action items (read-only) for any missing_metrics
5. **Wire into page** — `src/app/(app)/credit-memo/[dealId]/canonical/page.tsx` — add `<MemoCompletionWizard>` button alongside Run Research / Generate Narratives; pass `principals` from `res.memo.management_qualifications.principals` and `missingMetrics` from `res.memo.meta.readiness.missing_metrics`

**Migration SQL:**
```sql
CREATE TABLE IF NOT EXISTS deal_memo_overrides (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id    uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  bank_id    uuid NOT NULL,
  overrides  jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, bank_id)
);
ALTER TABLE deal_memo_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bank_rls" ON deal_memo_overrides
  USING (bank_id = (SELECT bank_id FROM deals WHERE id = deal_id LIMIT 1));
```

---

## Architectural Decision — Wizard as Stopgap

The wizard is an explicit interim solution. The permanent solution is:

**Borrower Intake Pipeline (future):**
- Voice interview (`gpt-4o-realtime-preview`) → captures business description,
  seasonality, revenue mix, competitive advantages, management background
- Intake form wizard → structured capture of principal bios, entity history
- These write directly to `borrowers`, `ownership_entities`, and deal intake tables
- `buildCanonicalCreditMemo` reads from those tables directly — `business_summary`
  and `management_qualifications` auto-populate without any wizard

**Deprecation path:** When intake is wired, remove the `deal_memo_overrides`
query from `buildCanonicalCreditMemo` and drop the wizard button from the page.
The `deal_memo_overrides` table can be archived. Zero other changes needed.

---

## Current State — Active Deals

**Deal ffcc9733** — Samaritus Management LLC (primary active test deal)
- 9/9 docs. NET_INCOME = $204,096 (2025). ADS = $67,368. DSCR = 3.03x.
- ✅ AI Risk: BB+ grade, 975 bps
- ✅ BIE: LIVE — 9 memo subsections with Gemini-written content
- ✅ B&I Analysis: clean — BIE-priority, no BRE prefix, no SBA bleed
- ✅ Personal income: key mismatch fixed
- 🔴 Generate Narratives: was timing out — fixed by maxDuration (Phase 48A)
- 🔴 Qualitative fields: "Pending" — fixed by wizard (Phase 48B)
- 🔴 Reconciliation: `recon_status` NULL — blocks Committee signal

---

## Known Gaps — Priority Order

### P1 — Immediate (Phase 48 unblocks these)

1. **Deploy Phase 48A** — narratives `maxDuration` fix, then click Generate Narratives
2. **Deploy Phase 48B** — wizard, then fill in business description / bios
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
| chatAboutDeal | OpenAI gpt-4o-2024-08-06 | OpenAI API key | 🔴 Gemini migration queued (P3) |

---

## Definition of Done — God Tier

1–60. ✅ All prior phases and AARs complete through Phase 35 + AARs 45/46/47.
61. 🔴 Phase 48A deployed — Generate Narratives completes successfully
62. 🔴 Phase 48B deployed — wizard fills qualitative fields, memo looks complete
63. 🔴 Reconciliation complete — Committee Approve signal unlocked
64. 🔴 Borrower Intake wired — wizard deprecated, qualitative fields auto-populate
65. 🔴 Spread completeness ≥80%
66. 🔴 Banker experience — opens a spread, trusts every number, focuses on credit

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
| **Phase 48A** | **Narratives route `maxDuration=60` — Generate Narratives was timing out silently** | **🔴 Deploy** | **—** |
| **Phase 48B** | **Memo Completion Wizard — qualitative stopgap (business desc, bios, collateral prose)** | **🔴 Build** | **—** |
| Reconciliation | `recon_status` — Committee Approve signal | 🔴 Active | — |
| Borrower Intake | Voice interview + forms → auto-populate memo (replaces wizard) | 🔴 Queued | — |
| Model Engine V2 | Feature flag + seeding + wiring | 🔴 Queued | — |
| Observability | Telemetry pipeline activation | 🔴 Queued | — |
| Corpus Expansion | 10+ verified docs across industries | 🔴 Queued | — |

---

*The mission: a system that proves itself right before delivery —
so bankers focus entirely on credit judgment.*
