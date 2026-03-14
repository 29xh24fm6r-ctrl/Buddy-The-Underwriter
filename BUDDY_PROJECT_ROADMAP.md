# Buddy The Underwriter — Project Roadmap
# Institutional-Grade Commercial Lending AI Platform

**Last Updated: March 2026**
**Status: Phase 30 active — AI Risk Assessment LIVE ✅ | AAR 34 complete**

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
        ↓ Credit Memo + Committee Package
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

## Phase 30 — Deal Flow to Approval (Active)

### AAR 25–33 ✅ — See prior roadmap entries for full details

### AAR 34 — Hand-written `structureHint` in prompt — AI Risk Assessment LIVE ✅ COMPLETE

**Root cause of AAR 34:** Even with `responseJsonSchema` (correct field from AAR 33
research), the `zodToJsonSchema` output includes strict constraints — `additionalProperties: false`,
`minimum`/`maximum` on numbers, enum constraints — that cause Gemini 3 Flash to
serialize array items as plain text strings when it cannot satisfy all constraints
simultaneously. These plain strings don't start/end with `{}` so `unwrapJsonStrings`
cannot recover them.

**Fix:** Removed `responseJsonSchema` entirely and `zodToJsonSchema` import.
Replaced with a clean `structureHint` string passed alongside the prompt — a
hand-written JSON structure example showing field names and types without any
constraints. `responseMimeType: "application/json"` alone ensures valid JSON output.
Zod validates the result against the full schema for type safety downstream.

This is exactly how Gemini 2.0 Flash works throughout the rest of the extraction
pipeline — and it has always worked reliably.

**Result: BB+ grade, 975 bps total pricing, 4 risk factors, 3 pricing adders,
rendered live on deal ffcc9733. 34 AARs to get here.**

**Final working pattern for Gemini 3 Flash structured output:**
```typescript
// generationConfig — NO responseJsonSchema, NO responseSchema
generationConfig: {
  responseMimeType: "application/json",   // JSON mode only
  maxOutputTokens: 8192,
  thinkingConfig: { thinkingLevel: "minimal" },
}

// Prompt includes a clean hand-written structure hint — no constraints, no $schema keywords
const prompt = `${system}\n\nReturn ONLY a valid JSON object with this structure:\n${structureHint}\n\nINPUT:\n${payload}`;
```

**Build principle:** When Gemini structured output schema enforcement produces
serialization failures, fall back to `responseMimeType: "application/json"` only
with a clean hand-written structure hint in the prompt. Zod validates downstream.
`zodToJsonSchema` output contains strict keywords (`additionalProperties: false`,
numeric bounds) that Gemini cannot always satisfy for deeply nested objects — this
causes it to serialize the entire parent as a plain text string. A simple structural
example in the prompt avoids all constraint pressure while still guiding field names.

---

## Current State — Active Deals

**Deal ffcc9733** — Samaritus Management LLC (primary active)
9/9 docs extracted. Revenue: $798K → $1.2M → $1.5M → $1.4M.
EBITDA: $326K → $475K → $557K → $368K. ADS=$67,368. DSCR=5.47x.
**✅ AI Risk Assessment LIVE: BB+ grade, 975 bps (Base: 525 + Premium: 450)**
Next: Generate Narratives → Regenerate Classic Spread → Reconciliation → Committee.

---

## Known Gaps — Priority Order

### P1 — Immediate: Complete deal ffcc9733 approval flow

1. **✅ Risk tab → AI Risk Assessment** — COMPLETE. BB+ grade live.
2. **Credit Memo → "Generate Narratives"** — Writes to `canonical_memo_narratives`.
3. **Classic Spreads → "Regenerate"** — Picks up all Phase 29/30 fixes.
4. **Reconciliation** — `recon_status` NULL. Blocks Committee "Reconciliation Complete".
5. **Audit certificates** — 0 certs. Check after next re-extract cycle.

**Committee "Approve" signal requires:** DSCR ≥ 1.25x ✅, 0 critical flags ✅,
Reconciliation CLEAN/FLAGS ❌, Extraction confidence ≥ 85% ❌, Financial data ✅, Pricing ✅.

### P2 — Near Term

2. **Model Engine V2 activation** — feature flag disabled, DB tables empty, Pulse telemetry not forwarding.
3. **Observability pipeline** — missing env vars: PULSE_TELEMETRY_ENABLED, PULSE_BUDDY_INGEST_URL, PULSE_BUDDY_INGEST_SECRET, CRON_SECRET.
4. **Corpus expansion** — 2 Samaritus docs. Need 10+ across industries.

### P3 — Future

5. **chatAboutDeal Gemini migration**
6. **Crypto lending module**
7. **Treasury product auto-proposal engine**
8. **RMA peer/industry comparison**

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
| Credit memo generation | Gemini 2.0 Flash | Vertex AI / GCP ADC | ✅ |
| Document classification | Gemini 2.0 Flash | Vertex AI / GCP ADC | ✅ Active (Phase 24) |
| Voice interview sessions | gpt-4o-realtime-preview | OpenAI API key | ✅ Retained on OpenAI |
| Risk + Memo orchestrator | Gemini 3 Flash | GEMINI_API_KEY (Dev API) | ✅ **LIVE — BB+ grade on ffcc9733** |
| chatAboutDeal | OpenAI gpt-4o-2024-08-06 | OpenAI API key | 🔴 Gemini migration queued (P3) |

---

## Definition of Done — God Tier

1–32. ✅ All foundation phases and MMAS sprint items complete.
33. ✅ Gemini 3 Flash orchestrator cutover complete
34. ✅ OpenAI zodToJsonSchema schema wrapping fixed (AAR 24)
35–37. ✅ Spread fixes — hasMaterializedPI, Current Ratio, GEMINI_API_KEY (AARs 25–27)
38–42. ✅ Gemini structured output chain (AARs 28–32)
43. ✅ Research-grounded: `responseJsonSchema`, no schema in prompt, `thinkingLevel: "minimal"` (AAR 33)
44. ✅ **AI Risk Assessment LIVE — BB+ grade, 975 bps, rendered on deal ffcc9733 (AAR 34)**
45. 🔴 Credit Memo narratives generated
46. 🔴 Classic Spreads regenerated with all Phase 29/30 fixes
47. 🔴 Reconciliation complete — Committee Approve signal unlocked
48. 🔴 Spread completeness ≥80%
49. 🔴 Banker experience — opens a spread, trusts every number, focuses on credit

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
  - `zodToJsonSchema` output contains `additionalProperties: false` + numeric bounds that
    cause Gemini to serialize entire nested objects as plain strings — avoid entirely
  - `thinkingLevel: "minimal"` is the lowest valid level for Gemini 3 Flash
  - `thinkingBudget` is Gemini 2.5-series only
  - `"none"` is not a valid `thinkingLevel` — causes 400 INVALID_ARGUMENT
  - Evidence arrays must be `.optional().default([])` in Zod schemas
  - `unwrapJsonStrings()` pre-processor before Zod validation handles residual cases

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
| **AAR 34** | **structureHint in prompt — AI Risk Assessment LIVE (BB+, 975 bps)** | **✅ Complete** | **—** |
| Phase 30 | Deal flow to approval — narratives, reconciliation, committee | 🔴 Active | — |
| Model Engine V2 | Feature flag + seeding + wiring | 🔴 Queued | — |
| Observability | Telemetry pipeline activation | 🔴 Queued | — |
| Corpus Expansion | 10+ verified docs across industries | 🔴 Queued | — |

---

*The mission: a system that proves itself right before delivery —
so bankers focus entirely on credit judgment.*
