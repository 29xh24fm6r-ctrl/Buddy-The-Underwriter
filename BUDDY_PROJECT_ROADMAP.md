# Buddy The Underwriter — Project Roadmap
# Institutional-Grade Commercial Lending AI Platform

**Last Updated: March 2026**
**Status: Phase 30 active — deal flow to approval | AAR 32 complete**

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

**The target state:** Buddy solves Problem 1 completely and autonomously.
Humans focus entirely on Problem 2.

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

**Gate 1 — IRS Identity Checks** ✅ Phase 1
**Gate 2 — Multi-Source Corroboration** ✅ Phase 4
**Gate 3 — Reasonableness Engine (NAICS-calibrated)** ✅ Phase 4 + 6
**Gate 4 — Confidence Threshold** ✅ Phase 4
**Cross-Document Reconciliation** ✅ Phase 7
**Regression Protection (Golden Corpus)** ✅ Phase 8

---

## Completed Phases — Foundation through COS UI Migration

### PHASE 1–9 ✅ COMPLETE — PRs #169–#177
### Classic Banker Spread Sprint ✅ COMPLETE — PRs #180–#209
### Phases 10–24 ✅ COMPLETE — PRs #216–#229, commit dfdfc066

---

## After-Action Reviews — Current Session

### AAR 20–22b ✅ — fb811545, 6e449800, PR #231, PR #232
### Phase 25–29 ✅ — PR #233, bbee0903, 712961c5
### AAR 23 ✅ — `document_extracts` persistence fix
### Gemini 3 Flash Orchestrator Cutover ✅ — ORCHESTRATOR_USE_GEMINI3_FLASH=true
### AAR 24 ✅ — OpenAI zodToJsonSchema schema wrapping

---

## Phase 30 — Deal Flow to Approval (Active)

### AAR 25 ✅ — Global CF hasMaterializedPI > 1000 guard
### AAR 26 ✅ — Current Ratio / WC derived from SL_ components in spread-output
### AAR 27 ✅ — GEMINI_API_KEY added to Vercel + provider guard throws on misconfiguration
### AAR 28 ✅ — Gemini prompt embeds full JSON schema via zodToJsonSchema
### AAR 29 ✅ — Gemini `responseSchema` in `generationConfig` — API-level enforcement
### AAR 30 ✅ — Gemini array items unwrapped from JSON strings — `unwrapJsonStrings()` pre-processor
### AAR 31 ✅ — `thinkingConfig` omitted entirely when "none"; `"none"` is not a valid Gemini enum

### AAR 32 — `factors[].evidence` made optional to unblock Gemini serialization ✅ COMPLETE

**Root cause:** After AAR 31 (thinkingConfig omitted, 400 error resolved), still
getting `"expected object, received string"` at `factors[0]`. With thinking
disabled, Gemini's `responseSchema` enforcement correctly handles most fields,
but serializes entire `factors` array items as JSON strings when the item
contains a required complex nested array (`evidence: z.array(EvidenceRefSchema)`).

The divergence between `factors` and `pricingExplain` was the clue: `pricingExplain`
items have `evidence: z.array(EvidenceRefSchema).optional()` and work fine.
`factors` items have `evidence: z.array(EvidenceRefSchema)` — required — and fail.
`EvidenceRefSchema` includes optional `bbox` (object with 4 floats), `spanIds`
(string array), `excerpt` (string) — complex enough that without thinking mode,
Gemini serializes the whole parent object as a string rather than failing
individual fields.

**Fix — `src/lib/ai/schemas.ts`:**

Changed `factors[].evidence` from required to optional with default:
```typescript
// Before:
evidence: z.array(EvidenceRefSchema),

// After:
evidence: z.array(EvidenceRefSchema).optional().default([]),
```

**Why this is safe:** Downstream `generateMemo` already uses `f.evidence ?? []`
for all factor evidence access — the optional change has no runtime impact.
`pricingExplain[].evidence` was already optional for the same reason.

**Build principle:** For Gemini structured output with `thinkingConfig` omitted,
required complex nested arrays (especially those containing optional sub-objects
with many fields like `EvidenceRefSchema`) can cause Gemini to serialize the
entire parent object as a JSON string. Mark deeply nested array fields as
`.optional().default([])` to allow Gemini to omit them rather than failing
on the whole object. Evidence arrays should always be optional in AI output
schemas — evidence is best-effort, not required.

---

## Current State — Active Deals

**Deal ffcc9733** — Samaritus Management LLC (primary active)
9/9 docs extracted. Revenue: $798K → $1.2M → $1.5M → $1.4M.
EBITDA: $326K → $475K → $557K → $368K. ADS=$67,368. DSCR=5.47x.
AI Assessment should now succeed — `factors[].evidence` is optional.

**Deal 07541fce** — "CLAUDE FIX 21" / Samaritus Management LLC
Primary regression test deal. Run 21. 9/9 docs extracted.

---

## Known Gaps — Priority Order

### P1 — Immediate: Complete deal ffcc9733 approval flow

1. **Risk tab → "Run AI Assessment"** — AAR 32 fix. Should now succeed.
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
| Risk + Memo orchestrator | Gemini 3 Flash | GEMINI_API_KEY (Dev API) | ✅ **Cutover complete** |
| chatAboutDeal | OpenAI gpt-4o-2024-08-06 | OpenAI API key | 🔴 Gemini migration queued (P3) |

---

## Definition of Done — God Tier

1–32. ✅ All foundation phases and MMAS sprint items complete.
33. ✅ Gemini 3 Flash orchestrator cutover complete
34. ✅ OpenAI zodToJsonSchema schema wrapping fixed (AAR 24)
35. ✅ Global CF hasMaterializedPI > 1000 guard (AAR 25)
36. ✅ Current Ratio / Working Capital derived from SL_ components (AAR 26)
37. ✅ GEMINI_API_KEY added to Vercel — orchestrator fully active (AAR 27)
38. ✅ Gemini 3 Flash prompt embeds full JSON schema (AAR 28)
39. ✅ Gemini `responseSchema` in `generationConfig` — API-level enforcement (AAR 29)
40. ✅ Gemini array items unwrapped from JSON strings — `unwrapJsonStrings()` (AAR 30)
41. ✅ `thinkingConfig` omitted entirely when "none"; "none" not a valid enum (AAR 31)
42. ✅ **`factors[].evidence` made optional — matches `pricingExplain` pattern (AAR 32)**
43. 🔴 Deal `ffcc9733` through full approval flow — AI risk run, narratives, reconciliation, committee
44. 🔴 Spread completeness ≥80%
45. 🔴 Banker experience — opens a spread, trusts every number, focuses on credit

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
- Gemini 3 Flash uses `thinkingConfig.thinkingLevel` — omit `temperature` entirely.
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
- **For Gemini structured output, `responseSchema` in `generationConfig` is mandatory.
  Always pass alongside `responseMimeType: "application/json"`.**
- **Gemini's `responseSchema` can JSON-encode nested array items as strings even
  when the outer structure is correct. Always run `unwrapJsonStrings()` recursively
  before Zod validation. The unwrapper is idempotent.**
- **To disable Gemini thinking, omit `thinkingConfig` entirely from `generationConfig`.
  Do NOT pass `thinkingLevel: "none"` — `"none"` is not a valid enum value and
  causes 400 INVALID_ARGUMENT. Valid levels: `"minimal"`, `"low"`, `"medium"`, `"high"`.**
- **For Gemini structured output with `thinkingConfig` omitted, required complex
  nested arrays (e.g. `EvidenceRefSchema` with optional sub-objects) can cause
  Gemini to serialize the entire parent object as a string. Mark deeply nested
  array fields as `.optional().default([])`. Evidence arrays should always be
  optional in AI output schemas — evidence is best-effort, not required.**

---

## Progress Tracker

| Phase | Description | Status | PR / Commit |
|-------|-------------|--------|-------------|
| 1–9 | Foundation phases | ✅ Complete | #169–#177 |
| 2C–3D through AAR 19 | Classic Banker Spread sprint | ✅ Complete | #180–#209 |
| Phase 10–24 | COS UI + AI Provider Migration | ✅ Complete | #216–#229, dfdfc066 |
| AAR 20–22b | Intelligence tab, Classic Spreads, async extraction | ✅ Complete | fb811545, 6e449800, #231, #232 |
| Phase 25 | Gemini 3 Flash orchestrator shadow mode | ✅ Complete | PR #233 |
| Phase 26 | ai-risk route + Run AI Assessment button | ✅ Complete | bbee0903 |
| Phase 27 | Personal Income PDF page | ✅ Complete | 712961c5 |
| Phase 28 | Re-extraction dedup bypass + GEMINI_PRIMARY | ✅ Complete | — |
| AAR 23 | `document_extracts` persistence fix | ✅ Complete | — |
| Phase 29 | Intelligence tab 4-fix batch | ✅ Complete | — |
| Orchestrator Cutover | ORCHESTRATOR_USE_GEMINI3_FLASH=true | ✅ Complete | Vercel env var |
| AAR 24–30 | Gemini schema enforcement chain | ✅ Complete | — |
| AAR 31 | thinkingConfig omitted entirely when "none" | ✅ Complete | — |
| **AAR 32** | **`factors[].evidence` optional — complex nested arrays must be optional for Gemini** | **✅ Complete** | **—** |
| Phase 30 | Deal flow to approval — AI risk, narratives, reconciliation, committee | 🔴 Active | — |
| Model Engine V2 | Feature flag + seeding + wiring | 🔴 Queued | — |
| Observability | Telemetry pipeline activation | 🔴 Queued | — |
| Corpus Expansion | 10+ verified docs across industries | 🔴 Queued | — |

---

*The mission: a system that proves itself right before delivery —
so bankers focus entirely on credit judgment.*
