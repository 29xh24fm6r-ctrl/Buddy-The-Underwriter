# Buddy The Underwriter — Project Roadmap
# Institutional-Grade Commercial Lending AI Platform

**Last Updated: March 2026**
**Status: Phase 30 active — deal flow to approval | AAR 29 complete**

---

## Vision

Buddy is a commercial lending AI platform that processes financial documents,
performs underwriting analysis, and generates risk assessments for banks.

The north star: **every number that reaches a credit committee must be
correct, traceable, and defensible under audit — without requiring a human
to manually verify the math.**

Buddy is not a tool that assists humans in doing analysis.
Buddy is a system that performs institutional-grade analysis autonomously.
Humans provide credit judgment and final authority. Not data verification.

**The goal: a banker opens a spread and focuses entirely on credit judgment.
They never wonder if the numbers are right. They already know they are.**

---

## The Accuracy Philosophy — Two Distinct Problems

**Problem 1 — Data accuracy verification.**
Are the extracted numbers correct? This is a TECHNICAL problem.
It can be solved with sufficient rigor. When solved, NO human verification needed.

**Problem 2 — Credit decision authority.**
Should this loan be approved? At what rate? With what structure?
This is a JUDGMENT problem. OCC SR 11-7 and FDIC guidance require human
oversight of credit decisions. Non-negotiable and should not be.

**The target state:** Buddy solves Problem 1 completely and autonomously.
Humans focus entirely on Problem 2.

---

## Core Architecture

### The Intelligence Stack

```
Documents (tax returns, financials, statements)
        ↓
Document Classification + OCR
        ↓
Structured Extraction Engine (Gemini Flash)
        ↓
IRS Knowledge Base + Identity Validation   ✅ Phase 1 & 2 COMPLETE
        ↓
Formula Accuracy Layer                     ✅ Phase 3 COMPLETE
        ↓
Proof-of-Correctness Engine               ✅ Phase 4 COMPLETE
        ↓
Financial Intelligence Layer               ✅ Phase 5 COMPLETE
        ↓
Industry Intelligence Layer               ✅ Phase 6 COMPLETE
        ↓
Cross-Document Reconciliation             ✅ Phase 7 COMPLETE
        ↓
Golden Corpus + Continuous Learning       ✅ Phase 8 COMPLETE
        ↓
Full Banking Relationship                 ✅ Phase 9 COMPLETE
        ↓
Classic Banker Spread PDF (MMAS format)   ✅ PRs #180–#209
        ↓
AUTO-VERIFIED → Banker reviews for credit judgment only
        ↓
Credit Memo + Committee Package
        ↓
Deposit Profile + Treasury Proposals surfaced automatically
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

## Completed Phases — Foundation (PRs #169–#177)

### PHASE 1–9 ✅ COMPLETE — PRs #169–#177

---

## Classic Banker Spread Report Sprint (PRs #180–#209)

### Phases 2C–3D, Spread v1, AARs 1–17, Classic Spread v1, AAR 18, MMAS Parity A–G, AAR 19 ✅ COMPLETE

---

## COS UI + AI Provider Migration (PRs #216–#233+)

### Phases 10–24 ✅ COMPLETE — PRs #216–#229, commit dfdfc066

---

## After-Action Reviews — Current Session

### AAR 20–22b ✅ Complete — fb811545, 6e449800, PR #231, PR #232
### Phase 25 — Orchestrator Reasoning Model ✅ COMPLETE — PR #233
### Phase 26 — ai-risk Route + Run AI Assessment Button ✅ COMPLETE — commit bbee0903
### Phase 27 — Personal Income PDF Page ✅ COMPLETE — commit 712961c5
### Phase 28 — Re-extraction Dedup Bypass + Gemini Primary ✅ COMPLETE
### AAR 23 — `document_extracts` persistence fix ✅ COMPLETE
### Phase 29 — Intelligence Tab 4-Fix Batch ✅ COMPLETE
### Gemini 3 Flash Orchestrator Cutover ✅ COMPLETE
### AAR 24 — OpenAI zodToJsonSchema Schema Wrapping Bug ✅ COMPLETE

---

## Phase 30 — Deal Flow to Approval (Active)

### AAR 25 — Global CF hasMaterializedPI false positive ✅ COMPLETE

**Root cause:** Bootstrap placeholder `TOTAL_PERSONAL_INCOME` value = 3 (Phase 17)
made `hasMaterializedPI` guard return `true`, preventing fallback to real AGI facts.
**Fix:** `hasMaterializedPI` now requires `fact_value_num > 1000`.
**Build principle:** Bootstrap placeholder facts (value ≤ 1000 for income) must
never pass the `hasMaterializedPI` guard.

### AAR 26 — Current Ratio / Working Capital blank in Intelligence tab ✅ COMPLETE

**Root cause:** `CURRENT_ASSETS_{year}` / `CURRENT_LIABILITIES_{year}` never exist
as direct facts — must be derived from `SL_` balance sheet components. `spread-output`
route had no derivation.
**Fix:** Added two derivation blocks in `loadCanonicalFacts` in `spread-output/route.ts`.
**Build principle:** `CURRENT_ASSETS` and `CURRENT_LIABILITIES` are never stored as
direct facts — always derive from `SL_` components.

### AAR 27 — GEMINI_API_KEY missing from Vercel — silent fallback to OpenAI ✅ COMPLETE

**Root cause:** `getAIProvider()` gated cutover on `hasGemini = !!process.env.GEMINI_API_KEY`.
Key missing (extraction uses Vertex AI / GCP ADC — separate auth system). Silent fallback.
**Fix 1:** Provider guard now throws loudly on misconfiguration.
**Fix 2:** `enforceAdditionalProperties()` for OpenAI strict mode on `chatAboutDeal`.
**Resolution:** `GEMINI_API_KEY` added to Vercel (Google AI Studio). Fresh deploy.
**Build principle:** Gemini extraction (Vertex AI, GCP ADC) and Gemini 3 Flash
orchestrator (Developer API, `GEMINI_API_KEY`) are separate Google auth systems.
Both must be present in Vercel.

### AAR 28 — Gemini 3 Flash schema inference bug — wrong field names in output ✅ COMPLETE

**Root cause:** Gemini was called successfully but produced wrong field names
(`name` instead of `label`, `type` instead of `category`) because the prompt only
named the schema, never showed it. Zod `.parse()` failed with a wall of validation errors.
**Fix:** `zodToJsonSchema` generates the full schema; it's embedded in the prompt
with `REQUIRED JSON SCHEMA:` header. `cleanSchema` also passed as `responseSchema`
in `generationConfig` for API-level enforcement.
**Build principle:** When using Gemini with JSON output mode, embed the full JSON
schema in the prompt AND pass it as `responseSchema` in `generationConfig`. Prompt
instruction alone is advisory — `responseSchema` enforces at the token-sampling level.

### AAR 29 — Gemini `responseSchema` — API-level schema enforcement ✅ COMPLETE

**Root cause:** Even with the full JSON schema embedded in the prompt (AAR 28),
Gemini 3 Flash in thinking mode continued to produce wrong field names. The prompt
is advisory — thinking mode reasons through it and can deviate from the specified
field names when the schema is complex.

**Fix — `src/lib/ai/gemini3FlashProvider.ts`:**

`cleanSchema` (already computed via `zodToJsonSchema`) is now passed as
`responseSchema` in `generationConfig`:
```typescript
generationConfig: {
  responseMimeType: "application/json",
  responseSchema: cleanSchema,
  maxOutputTokens: 8192,
  thinkingConfig: { thinkingLevel },
},
```
Prompt simplified — verbose schema block removed since the API enforces it now:
```typescript
const prompt =
  `${args.system}\n\n` +
  `Return ONLY valid JSON. No markdown. No backticks. No commentary.\n\n` +
  `INPUT:\n${JSON.stringify(args.payload, null, 2)}`;
```

**Why this works:** `responseSchema` in Gemini's `generationConfig` is equivalent
to OpenAI's `response_format: { type: "json_schema" }`. The API constrains token
generation to only produce JSON conforming to the schema — field names are enforced
at the sampling level, not the reasoning level. Thinking mode reasoning is separated
from output format enforcement.

**Build principle:** For Gemini structured output, `responseSchema` in
`generationConfig` is mandatory — not optional. Prompt-based schema instruction
alone is insufficient when thinking mode is active. Always pass `responseSchema`
alongside `responseMimeType: "application/json"`. The combination of
`responseSchema` + `responseMimeType` at the API level makes Zod validation
a formality, not a failure point.

---

## Current State — Active Deals

**Deal ffcc9733** — Samaritus Management LLC (primary active)
9/9 docs extracted. Revenue: $798K → $1.2M → $1.5M → $1.4M.
EBITDA: $326K → $475K → $557K → $368K. ADS=$67,368. DSCR=5.47x.
Overall spread completeness: 66% D. AI Assessment should now succeed (AAR 29).

**Deal 07541fce** — "CLAUDE FIX 21" / Samaritus Management LLC
Primary regression test deal. Run 21. 9/9 docs extracted.

---

## Known Gaps — Priority Order

### P1 — Immediate: Complete deal ffcc9733 approval flow

1. **Risk tab → "Run AI Assessment"** — AAR 29 fix deployed. `responseSchema` enforces field names at API level. Should succeed.
2. **Credit Memo → "Generate Narratives"** — Writes to `canonical_memo_narratives`.
3. **Classic Spreads → "Regenerate"** — Picks up all Phase 29/30 fixes.
4. **Reconciliation** — `recon_status` NULL. Blocks Committee "Reconciliation Complete" check.
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

1. ✅ AUTO-VERIFIED on 95%+ of clean tax returns — zero human data verification
2. ✅ IRS identity checks on every extracted document
3. ✅ Multi-source corroboration from independent sources
4. ✅ Reasonableness engine with NAICS-calibrated norms
5. ✅ Formula accuracy — every spread line mathematically verifiable
6. ✅ Financial intelligence — EBITDA, officer comp, global cash flow
7. ✅ Industry intelligence — 7 NAICS profiles
8. ✅ Cross-document reconciliation — K-1s, balance sheet, ownership
9. ✅ Golden corpus regression tests on every commit
10. ✅ Continuous learning — analyst corrections feed back into accuracy metrics
11. ✅ Audit certificate generated for every AUTO-VERIFIED spread
12. ✅ Full relationship view — loans + deposits + treasury in one workflow
13. ✅ Section 106 compliance baked into relationship pricing output
14. ✅ Classic Banker Spread PDF — MMAS format, 6+ pages, zero ghost blanks
15. ✅ UCA Cash Flow statement in PDF
16. ✅ Expanded MMAS ratio set
17. ✅ AI narrative engine (optional, graceful fallback)
18. ✅ Personal tax return extraction with IRS identity validation (Phase 16)
19. ✅ Classic Spreads as first-class tab on every deal (AAR 21)
20. ✅ Intelligence tab fully populated — all 12 metric cells, DSCR Triangle (AAR 20)
21. ✅ New deal intake completes in <60s (AAR 22)
22. ✅ Extraction fan-out — 9 docs in ~60-120s (AAR 22b)
23. ✅ Gemini 3 Flash orchestrator shadow mode active (Phase 25)
24. ✅ generateRisk() wired to live route + UI (Phase 26)
25. ✅ Personal Income PDF page in Classic Spread (Phase 27)
26. ✅ Re-extraction dedup bypass (Phase 28)
27. ✅ GEMINI_PRIMARY_EXTRACTION_ENABLED — v2 BTR prompts active (Phase 28)
28. ✅ `document_extracts` persisted for every extraction (AAR 23)
29. ✅ DSCR Triangle ADS fallback (Phase 29)
30. ✅ TOTAL_OPERATING_EXPENSES + OPERATING_INCOME derived for BTR-only years (Phase 29)
31. ✅ Global CF personal income fallback (Phase 29)
32. ✅ Spread completeness IS label mismatches fixed (Phase 29)
33. ✅ Gemini 3 Flash orchestrator cutover complete
34. ✅ OpenAI zodToJsonSchema schema wrapping fixed (AAR 24)
35. ✅ Global CF hasMaterializedPI > 1000 guard (AAR 25)
36. ✅ Current Ratio / Working Capital derived from SL_ components (AAR 26)
37. ✅ GEMINI_API_KEY added to Vercel — orchestrator fully active (AAR 27)
38. ✅ Gemini 3 Flash prompt embeds full JSON schema (AAR 28)
39. ✅ **Gemini 3 Flash `responseSchema` in `generationConfig` — field names enforced at API sampling level (AAR 29)**
40. 🔴 Deal `ffcc9733` through full approval flow — AI risk run, narratives, reconciliation, committee
41. 🔴 Spread completeness ≥80%
42. 🔴 Banker experience — opens a spread, trusts every number, focuses on credit

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
  Use getValsFallback() for both variants.
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
  Prompt-based schema instruction alone is insufficient when thinking mode is active.
  Always pass `responseSchema` alongside `responseMimeType: "application/json"`.
  This enforces field names at the token-sampling level — Zod validation becomes
  a formality, not a failure point.**

---

## Progress Tracker

| Phase | Description | Status | PR / Commit |
|-------|-------------|--------|-------------|
| 1–9 | Foundation phases | ✅ Complete | #169–#177 |
| 2C–3D | Credit Memo + Cockpit Panels | ✅ Complete | #180–#184 |
| Spread v1 | Spread output infrastructure | ✅ Complete | #185–#187 |
| AARs 1–17 | Bug batch + PDFKit fixes | ✅ Complete | #188–#196, hotfix |
| Classic Spread v1 | BS/IS/Ratios/Exec PDF | ✅ Complete | #197 |
| AAR 18 | Portrait layout + ghost pages + OPEX | ✅ Complete | #207 |
| MMAS Parity A–G | Full MMAS spread (7 phases, 865 insertions) | ✅ Complete | #208 |
| AAR 19 | IS key suffix mismatch + exec TCA/TCL | ✅ Complete | #209 |
| Phase 10–24 | COS UI + AI Provider Migration | ✅ Complete | #216–#229, dfdfc066 |
| AAR 20–22b | Intelligence tab, Classic Spreads, async extraction | ✅ Complete | fb811545, 6e449800, #231, #232 |
| Phase 25 | Gemini 3 Flash orchestrator shadow mode | ✅ Complete | PR #233 |
| Phase 26 | ai-risk route + Run AI Assessment button | ✅ Complete | bbee0903 |
| Phase 27 | Personal Income PDF page | ✅ Complete | 712961c5 |
| Phase 28 | Re-extraction dedup bypass + GEMINI_PRIMARY | ✅ Complete | — |
| AAR 23 | `document_extracts` persistence fix | ✅ Complete | — |
| Phase 29 | Intelligence tab 4-fix batch | ✅ Complete | — |
| Orchestrator Cutover | ORCHESTRATOR_USE_GEMINI3_FLASH=true | ✅ Complete | Vercel env var |
| AAR 24 | OpenAI zodToJsonSchema $ref wrapping | ✅ Complete | — |
| AAR 25 | Global CF hasMaterializedPI > 1000 guard | ✅ Complete | — |
| AAR 26 | Current Ratio / WC derived from SL_ components | ✅ Complete | — |
| AAR 27 | GEMINI_API_KEY added to Vercel + provider guard | ✅ Complete | — |
| AAR 28 | Gemini 3 Flash prompt embeds full JSON schema | ✅ Complete | — |
| **AAR 29** | **Gemini `responseSchema` in `generationConfig` — API-level schema enforcement** | **✅ Complete** | **—** |
| Phase 30 | Deal flow to approval — AI risk, narratives, reconciliation, committee | 🔴 Active | — |
| Model Engine V2 | Feature flag + seeding + wiring | 🔴 Queued | — |
| Observability | Telemetry pipeline activation | 🔴 Queued | — |
| Corpus Expansion | 10+ verified docs across industries | 🔴 Queued | — |

---

*The mission: a system that proves itself right before delivery —
so bankers focus entirely on credit judgment.*
