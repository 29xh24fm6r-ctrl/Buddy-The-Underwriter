# Buddy The Underwriter — Project Roadmap
# Institutional-Grade Commercial Lending AI Platform

**Last Updated: March 2026**
**Status: Phase 31 complete — Research Engine LIVE | Credit Memo gated on research**

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
        ↓ Credit Memo (research-grounded)           ✅ Phase 31
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

---

## Phase 30 — Deal Flow to Approval

### AAR 25–34 ✅ — Full Gemini structured output chain + AI Risk Assessment LIVE

**AI Risk Assessment result on deal ffcc9733:** BB+ grade, 975 bps (Base: 525 + Premium: 450),
4 risk factors, 3 pricing adders. Final working pattern: `responseMimeType: "application/json"`
only + clean `structureHint` in prompt. `zodToJsonSchema` output causes serialization failure
on deeply nested objects — avoid entirely for Gemini structured output.

---

## Phase 31 — Research Engine Activation + Credit Memo Integration ✅ COMPLETE

### What was built

The Buddy Research Engine (`src/lib/research/`) was fully implemented — 22 files,
~300KB of code covering source discovery, ingestion, fact extraction, inference
derivation, narrative compilation, conflict resolution, provenance scoring, and
integrity validation across 12 database tables. But zero missions had ever run
because no trigger route existed.

**FILE 1 — Created: `src/app/api/deals/[dealId]/research/run/route.ts`**

POST route that activates the dormant research engine:
- Resolves NAICS code from `borrowers.naics_code` via `deals.borrower_id`
- Falls back to `"999999"` if NAICS missing (never blocks)
- Dedupes against running/queued missions for the same deal
- Calls `runIndustryLandscapeMission()` at `"committee"` depth
- `maxDuration = 60` — runs synchronously to completion (research must complete before memo)
- Full UUID validation, error handling, pipeline ledger logging

**FILE 2 — Replaced: `src/app/api/deals/[dealId]/credit-memo/generate/route.ts`**

Replaced the legacy `aiJson()` path with the full Gemini 3 Flash provider:
- **Gate 1:** Requires completed AI risk assessment in `ai_risk_runs` — 400 if missing
- **Gate 2:** Requires completed research mission with narrative in `buddy_research_narratives` — 400 if missing
- Builds `dealSnapshot` including research narrative as plain text (sections → sentences)
- Calls `getAIProvider().generateMemo()` (Gemini 3 Flash path)
- Persists result to `canonical_memo_narratives`
- Logs pipeline ledger on success and failure

**The required sequence is now enforced in code:**
```
AI Risk Assessment ✅ → Research Run ✅ → Generate Credit Memo
```

**Build principle — research-gating credit memo:**
The credit memo AI prompt now includes institutional research narrative as context.
This gives Gemini 3 Flash industry benchmarks, competitive landscape, macro factors,
and regulatory environment to write against — not just deal financials in isolation.
A memo without research context is a formatted summary. A memo with research context
is institutional-grade credit analysis.

---

## Current State — Active Deals

**Deal ffcc9733** — Samaritus Management LLC (primary active)
9/9 docs extracted. Revenue: $798K → $1.2M → $1.5M → $1.4M.
EBITDA: $326K → $475K → $557K → $368K. ADS=$67,368. DSCR=5.47x.
✅ AI Risk Assessment LIVE: BB+ grade, 975 bps
**Next: Run Research → Generate Credit Memo → Regenerate Spreads → Reconciliation → Committee**

---

## Known Gaps — Priority Order

### P1 — Immediate: Complete deal ffcc9733 approval flow

1. **✅ Risk tab → AI Risk Assessment** — COMPLETE. BB+ grade live.
2. **Credit Memo tab → "Run Research"** — Triggers `/research/run`. Industry landscape mission.
3. **Credit Memo tab → "Generate Narratives"** — Now gated on research. Calls Gemini 3 Flash.
4. **Classic Spreads → "Regenerate"** — Picks up all Phase 29/30 fixes.
5. **Reconciliation** — `recon_status` NULL. Blocks Committee "Reconciliation Complete".
6. **Audit certificates** — 0 certs. Check after next re-extract cycle.

**Committee "Approve" signal requires:** DSCR ≥ 1.25x ✅, 0 critical flags ✅,
Reconciliation CLEAN/FLAGS ❌, Extraction confidence ≥ 85% ❌, Financial data ✅, Pricing ✅.

### P2 — Near Term

- **Model Engine V2 activation** — feature flag disabled, DB tables empty, Pulse telemetry not forwarding.
- **Observability pipeline** — missing env vars: PULSE_TELEMETRY_ENABLED, PULSE_BUDDY_INGEST_URL, PULSE_BUDDY_INGEST_SECRET, CRON_SECRET.
- **Corpus expansion** — 2 Samaritus docs. Need 10+ across industries.

### P3 — Future

- **chatAboutDeal Gemini migration**
- **Crypto lending module**
- **Treasury product auto-proposal engine**
- **RMA peer/industry comparison**

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
34. ✅ OpenAI zodToJsonSchema schema wrapping fixed (AAR 24)
35–37. ✅ Spread fixes — hasMaterializedPI, Current Ratio, GEMINI_API_KEY (AARs 25–27)
38–42. ✅ Gemini structured output chain (AARs 28–32)
43. ✅ Research-grounded: `responseJsonSchema`, no schema in prompt, `thinkingLevel: "minimal"` (AAR 33)
44. ✅ AI Risk Assessment LIVE — BB+ grade, 975 bps (AAR 34)
45. ✅ **Research Engine activated — `/research/run` wired to `runIndustryLandscapeMission()` (Phase 31)**
46. ✅ **Credit Memo gated on research — `generateMemo()` receives research narrative context (Phase 31)**
47. 🔴 Run Research on ffcc9733 — first live mission
48. 🔴 Generate Credit Memo — first research-grounded memo
49. 🔴 Classic Spreads regenerated with all Phase 29/30 fixes
50. 🔴 Reconciliation complete — Committee Approve signal unlocked
51. 🔴 Spread completeness ≥80%
52. 🔴 Banker experience — opens a spread, trusts every number, focuses on credit

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
  ≥20 rows at ≥95% agree. **Exception: if primary is broken and gate cannot
  fill, bypass it directly.**
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
  - Clean `structureHint` string in prompt showing field names/types without constraints
  - `zodToJsonSchema` output causes plain-string serialization of nested objects — avoid entirely
  - `thinkingLevel: "minimal"` is the lowest valid level for Gemini 3 Flash
  - `thinkingBudget` is Gemini 2.5-series only; `"none"` causes 400 INVALID_ARGUMENT
  - Evidence arrays must be `.optional().default([])` in Zod schemas
  - `unwrapJsonStrings()` pre-processor before Zod validation handles residual cases
- **Research must complete before credit memo generation.** The memo prompt includes
  the full research narrative (industry benchmarks, competitive landscape, macro context)
  as context. A memo without research is a formatted summary — not institutional-grade analysis.
- **`runMission()` is imported from `"@/lib/research/runMission"` directly, not from
  `"@/lib/research"` — it is server-only and not re-exported from the index.**

---

## Progress Tracker

| Phase | Description | Status | PR / Commit |
|-------|-------------|--------|-------------|
| 1–9 | Foundation phases | ✅ Complete | #169–#177 |
| 2C–3D through AAR 19 | Classic Banker Spread sprint | ✅ Complete | #180–#209 |
| Phase 10–24 | COS UI + AI Provider Migration | ✅ Complete | #216–#229, dfdfc066 |
| AAR 20–22b | Intelligence tab, Classic Spreads, async extraction | ✅ Complete | fb811545, 6e449800, #231, #232 |
| Phase 25–29 | Orchestrator + Personal Income + Intelligence fixes | ✅ Complete | PR #233, bbee0903, 712961c5 |
| AAR 23–24 | document_extracts persistence, OpenAI schema wrapping | ✅ Complete | — |
| Orchestrator Cutover | ORCHESTRATOR_USE_GEMINI3_FLASH=true | ✅ Complete | Vercel env var |
| AAR 25–27 | hasMaterializedPI, Current Ratio, GEMINI_API_KEY | ✅ Complete | — |
| AAR 28–32 | Gemini structured output chain (5 iterations) | ✅ Complete | — |
| AAR 33 | Research-grounded: responseJsonSchema, minimal thinking | ✅ Complete | — |
| AAR 34 | structureHint in prompt — AI Risk Assessment LIVE (BB+, 975 bps) | ✅ Complete | — |
| **Phase 31** | **Research Engine activated + Credit Memo gated on research** | **✅ Complete** | **—** |
| Phase 30 remaining | Narratives, Classic Spreads, Reconciliation, Committee | 🔴 Active | — |
| Model Engine V2 | Feature flag + seeding + wiring | 🔴 Queued | — |
| Observability | Telemetry pipeline activation | 🔴 Queued | — |
| Corpus Expansion | 10+ verified docs across industries | 🔴 Queued | — |

---

*The mission: a system that proves itself right before delivery —
so bankers focus entirely on credit judgment.*
