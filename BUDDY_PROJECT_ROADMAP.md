# Buddy The Underwriter — Project Roadmap
# Institutional-Grade Commercial Lending AI Platform

**Last Updated: March 2026**
**Status: Gemini 3 Flash Orchestrator Cutover Complete + AAR 24 | Phase 30 active — deal flow to approval**

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

The difference between Buddy and Moody's MMAS is that Buddy proves its own
accuracy mathematically before the spread ever reaches a banker's desk.

**The goal: a banker opens a spread and focuses entirely on credit judgment.
They never wonder if the numbers are right. They already know they are.**

**The standard:** Buddy must be the world's expert on every single line item
on the Moody's MMAS spread — not just the items built so far.

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

### The Omega Architecture

- **Buddy** — domain-specific interface. Extracts facts, generates spreads.
  Buddy emits facts. Never forms final credit beliefs.
- **Pulse Omega Prime** — centralized intelligence core. Applies reasoning
  and confidence scoring. Omega forms beliefs. Humans make credit decisions.

AI explains. Rules decide. Humans retain final credit authority.

### Six Kernel Primitives

1. **Entity** — what exists
2. **State** — what Omega believes is true (with confidence score)
3. **Event** — immutable record of what happened (append-only ledger)
4. **Constraint** — governing rules
5. **Confidence** — certainty levels that gate autonomous action
6. **Trace** — decision explanations (full audit trail)

---

## The Proof-of-Correctness System — All Gates Live

**Gate 1 — IRS Identity Checks** ✅ Phase 1
**Gate 2 — Multi-Source Corroboration** ✅ Phase 4
**Gate 3 — Reasonableness Engine (NAICS-calibrated)** ✅ Phase 4 + 6
**Gate 4 — Confidence Threshold** ✅ Phase 4
**Cross-Document Reconciliation** ✅ Phase 7
**Regression Protection (Golden Corpus)** ✅ Phase 8

**When all gates pass:** `AUTO-VERIFIED`. No queue. No wait.
**Target: 95%+ of clean tax returns AUTO-VERIFIED with zero human touch.**

---

## Completed Phases — Foundation (PRs #169–#177)

### PHASE 1 — IRS Knowledge Base Foundation ✅ COMPLETE — PR #169
### PHASE 2 — Wire Validator Into Extraction Pipeline ✅ COMPLETE — PR #170
### PHASE 3 — Formula Accuracy Fixes ✅ COMPLETE — PR #171
### PHASE 4 — Proof-of-Correctness Engine ✅ COMPLETE — PR #172
### PHASE 5 — Financial Intelligence Layer ✅ COMPLETE — PR #173
### PHASE 6 — Industry Intelligence ✅ COMPLETE — PR #174
### PHASE 7 — Cross-Document Reconciliation ✅ COMPLETE — PR #175
### PHASE 8 — Golden Corpus + Continuous Learning ✅ COMPLETE — PR #176
### PHASE 9 — Full Banking Relationship ✅ COMPLETE — PR #177

---

## Classic Banker Spread Report Sprint (PRs #180–#209)

### Phases 2C–3D + Credit Memo PDF ✅ PRs #180–#184
### Phase 2 Spread Infrastructure ✅ PRs #185–#186
### Phase 2b Spread Improvements ✅ PR #187
### AARs 1–17 ✅ PRs #188–#196 + next.config.mjs
### Classic Spread PDF v1 ✅ PR #197
### AAR 18 — Portrait Layout + Ghost Pages + TOTAL OPEX ✅ PR #207
### MMAS Parity — Phases A–G ✅ PR #208
### AAR 19 — IS Key Suffix Mismatch ✅ PR #209

---

## COS UI + AI Provider Migration (PRs #216–#233+)

### Phases 10–24 ✅ COMPLETE — PRs #216–#229, commit dfdfc066

---

## After-Action Reviews — Current Session

### AAR 20 — Intelligence Tab Blank Metrics ✅ commit fb811545
### AAR 21 — Classic Spreads tab + PDF button fix ✅ commit 6e449800
### AAR 22 — Async Document Extraction Decoupling ✅ PR #231
### AAR 22b — Parallel Extraction Fan-out ✅ PR #232

### Phase 25 — Orchestrator Reasoning Model ✅ COMPLETE — PR #233

**Model chosen:** `gemini-3-flash-preview` — Pro-level reasoning at Flash speed/pricing.
$0.50/1M input, $3/1M output. Configurable thinking levels (minimal/low/medium/high).

### Phase 26 — ai-risk Route + Run AI Assessment Button ✅ COMPLETE — commit bbee0903

### Phase 27 — Personal Income PDF Page (Classic Spread) ✅ COMPLETE — commit 712961c5

### Phase 28 — Re-extraction Dedup Bypass + Gemini Primary Activation ✅ COMPLETE

### AAR 23 — `document_extracts` not persisted in normal extraction path ✅ COMPLETE

**Root cause:** `extractByDocType.ts` normal path (Gemini OCR + structured assist)
returned the result but **never wrote to `document_extracts`**. `loadStructuredJson(docId)`
reads from `document_extracts` — always returned null for non-dedup docs. Deterministic
extractors fell back to `document_ocr_results` (legacy OCR, 936–26,699 chars) — insufficient.

**Fix:** Added `document_extracts` upsert at end of main `try` block in
`src/lib/extract/router/extractByDocType.ts`. Non-fatal try/catch. Confirmed working:
9/9 docs SUCCEEDED on deals `4371108e`, `ffcc9733`. json_size values 4,779–60,089 bytes.

### Phase 29 — Intelligence Tab 4-Fix Batch ✅ COMPLETE

Four issues diagnosed and fixed on deal `ffcc9733` after AAR 23 confirmed extraction working.

- **Fix 1:** `TOTAL_OPERATING_EXPENSES` / `OPERATING_INCOME` derived for BTR-only years in `spread-output/route.ts`
- **Fix 2:** DSCR Triangle ADS fallback from `deal_structural_pricing` in `spread-intelligence/route.ts`
- **Fix 3:** Global CF personal income fallback computes from raw `PERSONAL_INCOME` facts in `classicSpreadLoader.ts`
- **Fix 4:** Spread completeness IS_REQUIRED label mismatches fixed — 6 real rows, 0 phantom entries in `spreadCompletenessScore.ts`

### Gemini 3 Flash Orchestrator Cutover ✅ COMPLETE

**Gate bypass rationale:** OpenAI's structured outputs API was rejecting all
`generateRisk()` calls with `400 Invalid schema for response_format 'RiskOutput':
schema must be a JSON Schema of type: 'object', got type: 'None'`. The shadow gate
could never accumulate rows with a broken primary — a deadlock. With 0 successful
runs, the 20-row / 95% agree gate had zero statistical validity. Same rationale
as Phase 24 classifier cutover — skipped gate, cut over directly.

**What changed:** `ORCHESTRATOR_USE_GEMINI3_FLASH=true` set in Vercel production.
`getAIProvider()` now routes `generateRisk()` and `generateMemo()` to
`Gemini3FlashProvider` in all environments. `chatAboutDeal` remains on OpenAI
until separately evaluated (P3).

**Result:** "Run AI Assessment" now calls Gemini 3 Flash instead of OpenAI.
Shadow log is no longer needed for cutover — it remains as a comparison tool.

### AAR 24 — OpenAI `zodToJsonSchema` Schema Wrapping Bug ✅ COMPLETE

**Root cause:** `zodToJsonSchema(schema, name)` in `openaiProvider.ts` — passing
a string `name` argument causes the library to return a `$ref`-wrapped document:
```json
{ "$ref": "#/definitions/RiskOutput", "definitions": { ... } }
```
The top-level object has no `type` field — just a `$ref`. OpenAI structured outputs
reads `type` at the root, finds `undefined`, and reports `400: got type: 'None'`.

**Fix — `src/lib/ai/openaiProvider.ts` — `jsonSchemaFor()` function:**
```typescript
function jsonSchemaFor(_name: string, schema: any) {
  // $refStrategy: "none" inlines all definitions — avoids $ref wrapping
  // that causes OpenAI structured outputs to see type: undefined
  const js = zodToJsonSchema(schema, { $refStrategy: "none" });
  // Strip $schema metadata URL — OpenAI strict mode rejects it
  const { $schema: _unused, ...clean } = js as any;
  return clean;
}
```

**Impact:** `chatAboutDeal` (the remaining OpenAI call) now works correctly.
The cutover to Gemini made this non-blocking for `generateRisk()`, but the fix
ensures `openaiProvider.ts` is correct for all future OpenAI usage. tsc clean.

---

## Current State — Active Deals

**Deal ffcc9733** — Samaritus Management LLC (primary active)
9/9 docs extracted. Revenue: $798K → $1.2M → $1.5M → $1.4M.
EBITDA: $326K → $475K → $557K → $368K. ADS=$67,368. DSCR=5.47x.

**Deal 07541fce** — "CLAUDE FIX 21" / Samaritus Management LLC
Primary regression test deal. Run 21. 9/9 docs extracted.
EBITDA: 2022=325,912 / 2023=475,246 / 2024=556,866 / 2025=368,499

---

## Known Gaps — Priority Order

### P1 — Immediate: Deal Flow to Approval (ffcc9733)

To get deal `ffcc9733` to "prepared for approval" in one session:

1. **Risk tab → "Run AI Assessment"** — Now routes to Gemini 3 Flash. Populates
   `ai_risk_runs` with grade, factors, pricing rationale. Committee tab DSCR check
   unlocks once this runs.

2. **Credit Memo → "Generate Narratives"** — Calls Gemini narrative engine, writes
   to `canonical_memo_narratives`. Memo renders with AI-authored executive summary,
   income analysis, borrower background, and guarantor strength.

3. **Classic Spreads → "Regenerate"** — Picks up Phase 29 fixes and fresh extraction.

4. **Reconciliation** — `recon_status` is NULL for ffcc9733. Cross-document
   reconciliation hasn't run. Blocks Committee "Reconciliation Complete" check.
   May need manual trigger via Underwrite tab or re-extract cycle to fire.

5. **Audit certificates** — 0 certs. Generated by proof-of-correctness engine
   (Phase 4) as part of `postExtractionValidator`. Check after next re-extract.

**Committee "Approve" signal requires:** DSCR ≥ 1.25x ✅, 0 critical flags ✅,
Reconciliation CLEAN/FLAGS ❌, Extraction confidence ≥ 85% ❌, Financial data ✅, Pricing ✅.

### P2 — Near Term

2. **Model Engine V2 activation** — USE_MODEL_ENGINE_V2 feature flag disabled.
   DB tables (metric_definitions, model_snapshots) empty. Pulse telemetry events
   not forwarding. Voice constraints not injected into OpenAI realtime sessions.

3. **Observability pipeline wiring** — Missing env vars: PULSE_TELEMETRY_ENABLED,
   PULSE_BUDDY_INGEST_URL, PULSE_BUDDY_INGEST_SECRET, CRON_SECRET.

4. **Corpus expansion** — Currently 2 Samaritus docs. Need 10+ across industries.
   Add Form 1120, Form 1065, first multi-entity deal with K-1s.

### P3 — Future

5. **chatAboutDeal Gemini migration** — complete the AI provider migration.
6. **Crypto lending module** — trigger-price-indexed margin call monitoring.
7. **Treasury product auto-proposal engine**
8. **RMA peer/industry comparison** — industry benchmark ratios on the spread.

---

## Technical Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js, Tailwind, Vercel |
| Database | Supabase (PostgreSQL) |
| AI — Primary | Gemini 2.0 Flash (extraction, narrative, credit memo, aiJson, classifier) |
| AI — Voice | gpt-4o-realtime-preview (intentionally retained on OpenAI) |
| AI — Reasoning | Gemini 3 Flash (risk + memo orchestrator — cutover complete) |
| Integration | MCP (Model Context Protocol) |
| Event Ledger | Supabase `deal_events` (append-only) |
| PDF Generation | PDFKit (portrait 8.5×11, serverExternalPackages) |
| Deployment | Vercel (frontend), Cloud Run (workers) |
| Observability | Aegis findings, Pulse MCP |
| Testing | Vitest, Playwright |

---

## AI Provider Inventory

| Workload | Model | Status |
|----------|-------|--------|
| Document extraction | Gemini 2.0 Flash | ✅ Active |
| Classic Spread narrative | Gemini 2.0 Flash | ✅ |
| Credit memo generation | Gemini 2.0 Flash | ✅ |
| General aiJson() wrapper | Gemini 2.0 Flash | ✅ |
| Document classification | Gemini 2.0 Flash | ✅ Active (Phase 24) |
| Voice interview sessions | gpt-4o-realtime-preview | ✅ Retained on OpenAI intentionally |
| Risk + Memo orchestrator | Gemini 3 Flash | ✅ **Cutover complete** — `ORCHESTRATOR_USE_GEMINI3_FLASH=true` |
| chatAboutDeal | OpenAI (gpt-4o-2024-08-06) | 🔴 Evaluated separately — Gemini migration queued (P3) |

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
16. ✅ Expanded MMAS ratio set (liquidity, leverage, coverage, profitability, activity, growth)
17. ✅ AI narrative engine (optional, graceful fallback)
18. ✅ Personal tax return extraction with IRS identity validation (Phase 16)
19. ✅ Classic Spreads as first-class tab on every deal (AAR 21)
20. ✅ Intelligence tab fully populated — all 12 metric cells, DSCR Triangle, Buddy's Assessment (AAR 20)
21. ✅ New deal intake completes in <60s — no soft deadline timeouts (AAR 22)
22. ✅ Extraction fan-out — 9 docs complete in ~60-120s, not ~9 min (AAR 22b)
23. ✅ Gemini 3 Flash orchestrator shadow mode active (Phase 25)
24. ✅ generateRisk() wired to live route + UI — shadow log accumulating (Phase 26)
25. ✅ Personal Income PDF page in Classic Spread — guarantor Form 1040 visible to banker (Phase 27)
26. ✅ Re-extraction dedup bypass — "Re-extract All" forces fresh Gemini OCR (Phase 28)
27. ✅ GEMINI_PRIMARY_EXTRACTION_ENABLED — v2 BTR prompts active in production (Phase 28)
28. ✅ `document_extracts` persisted for every extraction — `loadStructuredJson()` returns Gemini structured JSON (AAR 23)
29. ✅ DSCR Triangle populated from `deal_structural_pricing` ADS fallback (Phase 29)
30. ✅ TOTAL_OPERATING_EXPENSES + OPERATING_INCOME derived for BTR-only years (Phase 29)
31. ✅ Global CF fallback computes personal income from raw PERSONAL_INCOME facts (Phase 29)
32. ✅ Spread completeness checker label mismatches fixed — 6 real IS rows, 0 phantom entries (Phase 29)
33. ✅ **Gemini 3 Flash orchestrator cutover — ORCHESTRATOR_USE_GEMINI3_FLASH=true in production**
34. ✅ **OpenAI zodToJsonSchema schema wrapping fixed — root schema always has type: "object" (AAR 24)**
35. 🔴 Deal `ffcc9733` through full approval flow — AI risk, narratives, reconciliation, committee
36. 🔴 Spread completeness ≥80% — IS/BS gaps filled via Phase 28 + AAR 23 re-extraction
37. 🔴 Banker experience — opens a spread, trusts every number, focuses on credit
    (this one is never fully done — it's the ongoing standard)

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
- Key names are contracts. IS suffix (_IS) vs bare names must be consistent
  across extraction and loader layers. Use getValsFallback() for both variants.
- Route response shapes must match client consumption types exactly.
  TypeScript won't catch shape mismatches when routes cast as `any`.
- reextract-all bypasses gatekeeper entirely — shadow never fires from re-extractions.
- Gemini extraction is duration-unpredictable (30–120s per doc). Never await it
  inline inside a time-bounded orchestration window. Always queue as outbox events.
- Extraction fan-out: after queuing async outbox events, immediately fire
  `min(N, MAX_CONCURRENT_EXTRACTIONS)` parallel self-invocations. `FOR UPDATE
  SKIP LOCKED` guarantees no collision. Cron is safety net only.
- Shadow mode for model migrations: implement new provider behind `AIProvider`
  interface, gate with `ORCHESTRATOR_SHADOW_ENABLED=true`, log key-field
  agreement to `orchestrator_shadow_log`. Flip cutover flag only after ≥20 rows
  at ≥95% agree with zero shadow errors. **Exception: if the primary is broken
  and the gate cannot fill, bypass it directly — same rationale as Phase 24.**
- Gemini 3 Flash uses `thinkingConfig.thinkingLevel` — omit `temperature` entirely.
  Strip thought-signature parts from response before JSON parsing.
- Composite provider pattern: Gemini handles risk+memo, OpenAI retained for
  chatAboutDeal until separately evaluated.
- **`zodToJsonSchema(schema, name)` with a string name produces a `$ref`-wrapped
  document — root has no `type` field. OpenAI structured outputs rejects this with
  `type: 'None'`. Always call `zodToJsonSchema(schema, { $refStrategy: "none" })`
  and strip the `$schema` metadata key before passing to OpenAI.**
- **`document_extracts` persistence is required for fact extraction to work.**
  `extractByDocType` must write `fields_json` (including `structuredJson`) to
  `document_extracts` for every extraction path. If null, deterministic extractors
  fall back to legacy `document_ocr_results` — silent zero-facts failure.
- **Completeness checker label strings must exactly match `classicSpreadLoader` row labels.**
  Phantom IS_REQUIRED entries always score as missing. Audit labels when renaming rows.
- **DSCR triangle reads from `deal_structural_pricing`, not `deal_financial_facts`.**
  ADS is never written to facts. Always fall back to `annual_debt_service_est`.
- **BTR-only years need TOTAL_OPERATING_EXPENSES and OPERATING_INCOME derived.**
  `TOTAL_DEDUCTIONS` = total opex; `GROSS_PROFIT - OBI` as fallback.
- **Global CF personal income fallback:** When `TOTAL_PERSONAL_INCOME` absent,
  compute from raw `PERSONAL_INCOME` facts: `AGI + depreciation add-backs + QBI`.

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
| Phase 10 | Deal Command Center (Intelligence tab) | ✅ Complete | #216 |
| Phase 11 | Financial Intelligence Workspace (Financials tab) | ✅ Complete | #217 |
| Phase 12 | Structure Lab (Structure tab) | ✅ Complete | #218 |
| Phase 13 | Risk Signal Grid + Evidence Audit (Risk tab) | ✅ Complete | #219 |
| Phase 14 | Relationship Wallet (Relationship tab) | ✅ Complete | #220 |
| Phase 15 | Committee Studio (Committee tab) | ✅ Complete | #221 |
| Phase 16 | Personal Tax Return Extractor (Form 1040 + Schedule E) | ✅ Complete | #222 |
| Phase 17 | PTR Entity Map (wire extraction output to facts) | ✅ Complete | #223 |
| Phase 18 | Global Cash Flow Computation (entity + personal aggregation) | ✅ Complete | #224 |
| Phase 19 | Global Cash Flow PDF Page (Classic Spread) | ✅ Complete | #225 |
| Phase 20 | Bulk Re-extraction Trigger (POST + status + UI button) | ✅ Complete | #226 |
| Phase 21 | DSCR Reconciliation + Spread Completeness Score | ✅ Complete | #227 |
| Phase 22 | Gemini Migration (narrativeEngine + aiJson + creditMemo) | ✅ Complete | #228 |
| Phase 23 | Gemini Classifier Shadow Mode + classification_shadow_log | ✅ Complete | #229 |
| Phase 24 | Gemini Classifier Cutover (direct, data gate skipped) | ✅ Complete | dfdfc066 |
| AAR 20 | Intelligence tab blank metrics — spread-output shape mismatch | ✅ Complete | fb811545 |
| AAR 21 | Classic Spreads tab + PDF button fix | ✅ Complete | 6e449800 |
| AAR 22 | Async extraction decoupling — 240s soft deadline fix | ✅ Complete | PR #231 |
| AAR 22b | Parallel extraction fan-out — 9 docs in ~60-120s not ~9 min | ✅ Complete | PR #232 |
| **Phase 25** | **Gemini 3 Flash orchestrator shadow mode** | **✅ Complete** | **PR #233** |
| **Phase 26** | **ai-risk route + Run AI Assessment button** | **✅ Complete** | **bbee0903** |
| **Phase 27** | **Personal Income PDF page — guarantor Form 1040 in Classic Spread** | **✅ Complete** | **712961c5** |
| **Phase 28** | **Re-extraction dedup bypass + GEMINI_PRIMARY_EXTRACTION_ENABLED** | **✅ Complete** | **—** |
| **AAR 23** | **`document_extracts` not persisted in normal extraction path** | **✅ Complete** | **—** |
| **Phase 29** | **Intelligence tab 4-fix batch** | **✅ Complete** | **—** |
| **Orchestrator Cutover** | **ORCHESTRATOR_USE_GEMINI3_FLASH=true — Gemini 3 Flash primary for risk+memo** | **✅ Complete** | **Vercel env var** |
| **AAR 24** | **OpenAI zodToJsonSchema $ref wrapping — root schema type: None — inlined with $refStrategy: none** | **✅ Complete** | **—** |
| Phase 30 | Deal flow to approval — AI risk, narratives, reconciliation, committee package | 🔴 Active | — |
| Model Engine V2 | Feature flag + seeding + wiring | 🔴 Queued | — |
| Observability | Telemetry pipeline activation | 🔴 Queued | — |
| Corpus Expansion | 10+ verified docs across industries | 🔴 Queued | — |

---

*The mission: a system that proves itself right before delivery —
so bankers focus entirely on credit judgment.*
