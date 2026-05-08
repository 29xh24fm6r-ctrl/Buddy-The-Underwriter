# SPEC-FOUNDATION-V1-PR4-SPREAD-DIAGNOSIS — GLOBAL_CASH_FLOW Spread Reliability Investigation

**Path:** `specs/foundation-v1/SPEC-FOUNDATION-V1-PR4-SPREAD-DIAGNOSIS.md`
**Status:** Ready for Claude Code (diagnostic — produces a finding, not a fix)
**Owner:** Matt (architecture) → Claude Code (investigation)
**Branch:** opens against `feat/foundation-v1-pr4-spread-diagnosis`
**Depends on:** SPEC-FOUNDATION-V1 PR4-EXTRACT merged (`runCashFlowAggregator` extracted, route refactor live)
**Governs under:** SPEC-BANKER-HOLY-SHIT-V1 Workstream B (revised scope per research findings)
**Replaces in scope:** SPEC-FOUNDATION-V1 PR4-AUTOTRIGGER (not drafted) and the pre-research framing of Workstream B2

---

## What this spec is, and what it isn't

This is a **diagnostic spec**. It produces a finding about why the canonical GLOBAL_CASH_FLOW spread doesn't reliably render DSCR for fresh deals, and hands the finding back to Matt + Claude (in chat) to decide the remediation.

It is **not** a fix spec. It does not pre-commit to a solution. The implementer must investigate, observe, document, and report — without writing remediation code.

This spec exists because pre-research framing of Workstream B2 ("auto-trigger the aggregator after fact materialization") was based on an incomplete mental model of the compute architecture. Research revealed that the canonical compute pipeline is already designed correctly — `computeGlobalCashFlow` (pure), `persistGlobalCashFlow` (DB write), `computeTotalDebtService` (deal-level DSCR + stressed), and the GLOBAL_CASH_FLOW spread template (institutional-grade SBA SOP 50 10-compliant aggregation) all exist and run automatically via `spreadsProcessor`. The route's embedded compute (now `runCashFlowAggregator` after PR4-EXTRACT) is a **workaround** that populates the FINANCIAL_ANALYSIS.DSCR fact directly when the canonical spread chain doesn't produce it.

The diagnostic question is: why doesn't the canonical chain produce a non-null DSCR for fresh deals like Samaritus today, and what's the smallest fix that makes it reliable?

---

## Background — the compute architecture

This section captures the architecture as understood today so the implementer doesn't re-discover it. **Verify each claim against `main` during PIV — do not trust this summary.**

### Read path (canonical)

The credit memo's DSCR comes from `computeDscrGlobal` in `src/lib/creditMemo/canonical/factsAdapter.ts`. It tries in order:

1. GLOBAL_CASH_FLOW spread's `rendered_json`, looking for a row with key="DSCR" or label containing "dscr"
2. T12 spread's `rendered_json`, same lookup
3. FINANCIAL_ANALYSIS.DSCR fact directly

The readiness contract (`evaluateMemoReadinessContract`) reads `memo.financial_analysis.dscr.value` which is the result of `computeDscrGlobal`. So **the spread is canonical, the fact is fallback.**

### Write path 1 — canonical (via spreadsProcessor)

After document classification + fact extraction:
1. `spreadsProcessor.processSpreadJob` runs
2. Per active financial document, calls `extractFactsFromDocument` to populate raw facts
3. Renders all requested spreads (including GLOBAL_CASH_FLOW) via `renderSpread`
4. Calls `backfillCanonicalFactsFromSpreads` to materialize canonical facts from rendered spread cells
5. Calls `computeTotalDebtService` to write ANNUAL_DEBT_SERVICE_PROPOSED / EXISTING / total + DSCR + GCF_DSCR + DSCR_STRESSED_300BPS
6. Calls `persistGlobalCashFlow` to write GCF_GLOBAL_CASH_FLOW + GCF_DSCR via the pure `computeGlobalCashFlow` function (proper SBA SOP 50 10-compliant entity + sponsor aggregation)

The GLOBAL_CASH_FLOW spread template (`src/lib/financialSpreads/templates/globalCashFlow.ts`) reads facts and produces a 15-row rendered output across PERSONAL / PROPERTY / GLOBAL / DSCR sections. The DSCR row uses `preferFactOrComputed` — if a FINANCIAL_ANALYSIS.DSCR fact exists, it wins; otherwise the computed cell uses CASH_FLOW_AVAILABLE / ANNUAL_DEBT_SERVICE.

### Write path 2 — workaround (via Classic Spread route)

The Classic Spread PDF GET route calls `runCashFlowAggregator` (PR4-EXTRACT) which writes ANNUAL_DEBT_SERVICE / DSCR / CASH_FLOW_AVAILABLE / EXCESS_CASH_FLOW to facts using proposed-only ADS and the NCADS fallback chain (EBITDA → ORDINARY_BUSINESS_INCOME → NET_INCOME). This was the workaround that made Samaritus submittable when the canonical chain didn't produce a non-null DSCR.

### The conflict (and why it's smaller than it looked)

Both write paths target the same fact_keys (FINANCIAL_ANALYSIS.DSCR / ANNUAL_DEBT_SERVICE / etc.) with different semantics (proposed-only vs proposed+existing ADS; NCADS fallback vs CFA fact). For a deal with non-zero existing debt, last-write-wins produces inconsistent values.

But: `preferFactOrComputed` in the spread template means if either path writes the DSCR fact, the spread renders it. And the memo prefers the spread over the fact. So the architectural conflict is contained — it only matters at the fact-write layer for deals where both paths run and the spread is *also* not rendering.

The actual gap is: **why isn't the canonical spread chain reliably producing a non-null DSCR for fresh deals?** If we knew the answer, we'd know whether the route's workaround can be deprecated or whether it's still needed as defense-in-depth.

---

## PIV — pre-investigation verification

Run each of these against `main` and paste output into the AAR.

### PIV-1. Confirm the architecture summary above is current

Read each file fresh and confirm it matches the summary in the Background section:

```
src/lib/creditMemo/canonical/factsAdapter.ts (computeDscrGlobal function)
src/lib/financialSpreads/templates/globalCashFlow.ts (DSCR row uses preferFactOrComputed)
src/lib/jobs/processors/spreadsProcessor.ts (calls computeTotalDebtService + persistGlobalCashFlow)
src/lib/financialIntelligence/persistGlobalCashFlow.ts (calls computeGlobalCashFlow, writes GCF facts)
src/lib/financialIntelligence/computeGlobalCashFlow.ts (pure entity + sponsor aggregation)
src/lib/structuralPricing/computeTotalDebtService.ts (writes ADS_PROPOSED + EXISTING + total + DSCR family)
src/lib/financialFacts/runCashFlowAggregator.ts (workaround compute, post-PR4-EXTRACT)
src/app/api/deals/[dealId]/classic-spread/route.ts (calls runCashFlowAggregator)
```

If any file's actual shape diverges materially from the summary, **STOP** and surface to Matt before proceeding. Diagnostic findings are only as good as the architecture they describe.

### PIV-2. Sample the Samaritus current state

Run via `the buddy supa mcp:execute_sql`:

```sql
-- Current DSCR-related facts
SELECT 
  fact_type, fact_key, fact_value_num, 
  provenance->>'extractor' AS extractor,
  provenance->>'source_ref' AS source_ref,
  owner_type, owner_entity_id,
  created_at, updated_at
FROM deal_financial_facts
WHERE deal_id = '0279ed32-c25c-4919-b231-5790050331dd'
  AND is_superseded = false
  AND fact_key IN (
    'CASH_FLOW_AVAILABLE', 'ANNUAL_DEBT_SERVICE', 'ANNUAL_DEBT_SERVICE_PROPOSED',
    'ANNUAL_DEBT_SERVICE_EXISTING', 'ANNUAL_DEBT_SERVICE_STRESSED_300BPS',
    'DSCR', 'DSCR_STRESSED_300BPS', 'EXCESS_CASH_FLOW',
    'GCF_GLOBAL_CASH_FLOW', 'GCF_DSCR', 'GLOBAL_CASH_FLOW',
    'EBITDA', 'ORDINARY_BUSINESS_INCOME', 'NET_INCOME'
  )
ORDER BY fact_key, created_at DESC;
```

```sql
-- Current GLOBAL_CASH_FLOW spread state
SELECT 
  spread_type, status, 
  jsonb_pretty(rendered_json -> 'rows') AS rendered_rows,
  rendered_json -> 'meta' AS rendered_meta,
  error, error_code,
  created_at, updated_at, finished_at
FROM deal_spreads
WHERE deal_id = '0279ed32-c25c-4919-b231-5790050331dd'
  AND spread_type = 'GLOBAL_CASH_FLOW'
ORDER BY updated_at DESC
LIMIT 3;
```

```sql
-- Spread job history for GLOBAL_CASH_FLOW
SELECT 
  id, status, requested_spread_types, 
  attempt, max_attempts,
  error, 
  meta->>'preflight_retries' AS preflight_retries,
  created_at, updated_at, next_run_at
FROM deal_spread_jobs
WHERE deal_id = '0279ed32-c25c-4919-b231-5790050331dd'
ORDER BY created_at DESC
LIMIT 10;
```

```sql
-- Recent ledger events showing pipeline stages
SELECT 
  event_key, ui_state, ui_message,
  meta,
  created_at
FROM deal_pipeline_ledger
WHERE deal_id = '0279ed32-c25c-4919-b231-5790050331dd'
  AND event_key LIKE 'spread.%' 
   OR event_key LIKE 'facts.%'
   OR event_key LIKE 'gcf.%'
   OR event_key LIKE 'extraction.%'
ORDER BY created_at DESC
LIMIT 30;
```

Paste full output. The investigation hangs on what these reveal.

### PIV-3. Confirm test deal state matches expectations from PR4-PRECHECK

Per project memory, after PR4-EXTRACT merged and Samaritus's last Classic Spread route GET, the FINANCIAL_ANALYSIS.DSCR fact should be 2.94 with extractor `classicSpread:debtService:v1`. Confirm via PIV-2 output. If diverged, surface before proceeding.

---

## Investigation scope

Three questions to answer, in order. Each produces a documented finding. **Do not proceed to question N+1 if question N answers conclusively** — follow-up questions only matter if the prior question doesn't fully explain the gap.

### Question 1 — Does the GLOBAL_CASH_FLOW spread render at all for Samaritus?

**What to check:**
- PIV-2 spread query: does a row exist with `spread_type='GLOBAL_CASH_FLOW'`?
- If yes, what's its `status`? (`ready`, `error`, `queued`, `generating`?)
- If `error`, what's the `error_code` and `error` message?
- If `ready`, what's in `rendered_json -> rows`? Specifically the row with key="DSCR" — is its `value` null, a number, or missing entirely?
- If status is anything other than `ready`, why? (Check `deal_spread_jobs` history — was it queued? Did extraction prerequisites fail? Did `preflight_retries` exhaust?)

**Possible outcomes:**

- **1A — Spread doesn't exist at all.** No row in `deal_spreads`. Investigation jumps to question 2 (why didn't it queue/run).
- **1B — Spread exists but status='error'.** Capture error_code + error message. Investigation jumps to question 2 (why did rendering fail).
- **1C — Spread exists, status='ready', but DSCR row's value is null.** Render succeeded but inputs weren't there. Investigation jumps to question 3 (what fact inputs are missing).
- **1D — Spread exists, status='ready', DSCR row's value is non-null (e.g., 2.94).** The canonical chain works for Samaritus today. Workaround may not be needed. Investigation deliverable changes from "fix the chain" to "verify why we thought it was broken."

### Question 2 — If the spread didn't render or failed, why?

Only investigate if Q1 outcome was 1A or 1B.

**What to check:**
- `deal_spread_jobs` history: were any GLOBAL_CASH_FLOW jobs ever queued for this deal?
- If yes, what's their final status? `SUCCEEDED`, `FAILED`, still `QUEUED` waiting on retries?
- If FAILED, what was the error? Check `error_code` field (look for `MISSING_UPSTREAM_FACTS`, `EMPTY_SPREAD_RENDERED`, `TIMEOUT`, `TEMPLATE_NOT_FOUND`, `NO_FACTS_AFTER_RETRIES`).
- If never queued: who/what enqueues GLOBAL_CASH_FLOW jobs? Read `enqueueSpreadRecompute.ts` — does it include GLOBAL_CASH_FLOW in default request types? Are there call sites that should fire after document classification but don't?
- Check if the prerequisites in `globalCashFlowTemplate.prerequisites()` are gating the render (the template uses an "always renderable with partials" note — confirm).

**Possible outcomes:**

- **2A — Job never queued.** Trigger gap — the canonical chain is *designed* to auto-run but something prevents enqueue for Samaritus. Document where the gap is.
- **2B — Job queued but failed with MISSING_UPSTREAM_FACTS.** Specific facts the spread needs aren't being written. Investigation jumps to question 3.
- **2C — Job queued and ran but produced empty rows (`EMPTY_SPREAD_RENDERED`).** Same as 1C — render produced null DSCR. Jump to question 3.
- **2D — Job queued and timed out.** Capture timing data. Likely a different problem class (worker capacity / spread rendering perf). Document and stop.

### Question 3 — If the spread rendered with null DSCR, what fact inputs were missing or wrong?

Only investigate if Q1 outcome was 1C or Q2 outcome was 2B/2C.

**What to check:**

The GLOBAL_CASH_FLOW template's DSCR row needs **either** a FINANCIAL_ANALYSIS.DSCR fact (`preferFactOrComputed` returns it) **or** both CASH_FLOW_AVAILABLE and ANNUAL_DEBT_SERVICE facts (computed cell formula).

For Samaritus, per PIV-2 output, check:
- Is there a FINANCIAL_ANALYSIS.DSCR fact? (Should be — PR4-EXTRACT wrote one.)
- Is there a FINANCIAL_ANALYSIS.CASH_FLOW_AVAILABLE fact?
- Is there a FINANCIAL_ANALYSIS.ANNUAL_DEBT_SERVICE fact?
- What are their `created_at` timestamps relative to the spread's `updated_at`?

**The critical timing question:** when the spread last rendered, were the input facts already present? If facts were written *after* the spread last rendered, the spread reflects an older state and never gets re-rendered to pick up the new facts. (Spreads aren't auto-regenerated when underlying facts change unless something explicitly enqueues a recompute.)

**Possible outcomes:**

- **3A — Required facts are present but the spread renders null DSCR anyway.** Bug in the template or `preferFactOrComputed` logic. Capture exactly which inputs the template received vs what's in DB. This is a code bug.
- **3B — Required facts are present but were written *after* the spread last rendered.** Timing/recompute gap. Document the trigger that should have fired a spread re-render but didn't.
- **3C — Required facts are missing.** Trace upstream: which fact materialization step should have written them? Are inputs to that step present (raw extractions in `deal_financial_facts` with FINANCIAL_ANALYSIS or other fact_types)?

---

## Deliverable — the finding document

The implementer produces a written finding committed to `specs/foundation-v1/findings/SPEC-FOUNDATION-V1-PR4-SPREAD-DIAGNOSIS-FINDING.md`. The finding is the load-bearing output of this work.

**Required sections:**

1. **PIV outputs (raw).** All four PIV queries' results pasted as-is.
2. **Question 1 result** with outcome (1A/1B/1C/1D) and supporting evidence from PIV.
3. **Question 2 result** if applicable, with outcome (2A/2B/2C/2D).
4. **Question 3 result** if applicable, with outcome (3A/3B/3C).
5. **Root cause statement** — one paragraph naming why GLOBAL_CASH_FLOW doesn't reliably produce DSCR for fresh deals like Samaritus.
6. **Fix options** — 2-4 options for remediating the root cause, with effort estimates and trade-offs. **Do not pick one.** That's Matt + Claude in chat's call.
7. **Open questions** — anything the investigation surfaced that wasn't conclusively answered.

The finding does NOT include code changes. Investigation only. If the investigator notices a fix is one-line trivial, file it as an option in section 6, not as a PR.

---

## Hard non-goals

- **Do not write fix code in this PR.** The deliverable is the finding doc only. Even if the root cause is a one-line fix, write it as a recommendation in section 6, not as a code change. We pick the fix in a follow-up spec.
- **Do not modify the spread template, persistGlobalCashFlow, computeTotalDebtService, runCashFlowAggregator, or factsAdapter.** Read-only investigation.
- **Do not run the Classic Spread route on Samaritus during the investigation.** That would re-trigger the workaround and pollute the diagnostic state. PIV-2 reads current state without modifying it.
- **Do not re-trigger spread jobs on Samaritus during the investigation.** Same reason — observe current state first.
- **Do not propose architectural rewrites in section 6.** Fix options must be scoped to "smallest change that makes the canonical chain reliable for fresh deals." Architectural rewrites are a separate conversation.
- **Do not investigate other deals.** Samaritus is the canonical reference for this diagnostic. Other deals (OmniCare, Test Pack #1) have their own state drift; cross-deal inference dilutes the finding.

---

## File-by-file change plan

### New files

| Path | Purpose |
|------|---------|
| `specs/foundation-v1/findings/SPEC-FOUNDATION-V1-PR4-SPREAD-DIAGNOSIS-FINDING.md` | The investigation deliverable (created in this PR) |

### Modified files

**None.** This is a read-only investigation.

---

## V-N verification checklist

V-1. ☐ All four PIV outputs pasted into AAR.
V-2. ☐ PIV-1 architecture summary verified against `main`. Any divergence surfaced.
V-3. ☐ PIV-2 SQL outputs captured in finding doc as raw evidence.
V-4. ☐ Question 1 answered with outcome (1A/1B/1C/1D).
V-5. ☐ Question 2 answered if applicable (or explicitly skipped because Q1 was 1D).
V-6. ☐ Question 3 answered if applicable (or explicitly skipped).
V-7. ☐ Root cause statement present in finding doc.
V-8. ☐ At least 2 fix options proposed in finding doc, each with effort estimate + trade-offs.
V-9. ☐ Open questions section present (or explicit "no open questions" if conclusive).
V-10. ☐ Finding doc committed to `specs/foundation-v1/findings/`.
V-11. ☐ No production code modified — verified by `git diff main` showing only the new finding doc.
V-12. ☐ Samaritus's `deal_financial_facts` + `deal_spreads` state unchanged from PIV-2 baseline (no investigation-induced mutation).

---

## Risk register

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Investigator cannot reach a conclusive root cause | Section 7 (Open questions) absorbs ambiguity. Inconclusive findings are still valid findings — they tell us what additional instrumentation we need. |
| 2 | Investigation triggers a Samaritus state mutation | Hard non-goals + V-12 verification block this. Read-only SQL only. |
| 3 | Investigator drifts into fix mode mid-investigation | Hard non-goal #1 + the explicit "section 6 lists options, doesn't pick one" rule. Reviewer (Matt or Claude in chat) catches drift in AAR. |
| 4 | Architecture summary in this spec is wrong, misleading the investigation | PIV-1 catches this before investigation begins. If summary is wrong, investigator stops and surfaces. |
| 5 | Fix options surface conflicts that can't be resolved without bigger architectural decision | That's a valid finding. Section 7 captures it. We pick the fix scope in a follow-up spec. |
| 6 | Investigation reveals the canonical chain works fine for Samaritus and the workaround is unnecessary | That's outcome 1D and is the cleanest possible result. Section 5 root cause becomes "the workaround was added when the chain was less reliable; it's safely deprecatable now." Section 6 fix options become deprecation paths. |
| 7 | Investigation reveals the canonical chain has multiple compounding gaps | Section 6 captures multiple options at multiple scopes. We sequence the remediation across multiple sub-PRs. Diagnostic spec doesn't try to solve everything in one fix. |

---

## Hand-off commit message

```
spec(foundation): SPEC-FOUNDATION-V1-PR4-SPREAD-DIAGNOSIS — diagnostic investigation

Investigates why the canonical GLOBAL_CASH_FLOW spread chain doesn't
reliably produce DSCR for fresh deals like Samaritus, despite the
chain being designed correctly (computeGlobalCashFlow pure function,
persistGlobalCashFlow DB write, computeTotalDebtService for ADS family,
GLOBAL_CASH_FLOW spread template with SBA SOP 50 10-compliant aggregation).

Produces a written finding (specs/foundation-v1/findings/) with root
cause + fix options. No code changes. Read-only investigation.

The route's runCashFlowAggregator (PR4-EXTRACT) is a workaround that
populates FINANCIAL_ANALYSIS.DSCR directly when the canonical chain
doesn't. This diagnostic determines whether the workaround can be
deprecated or whether it's still needed as defense-in-depth.

Spec: specs/foundation-v1/SPEC-FOUNDATION-V1-PR4-SPREAD-DIAGNOSIS.md
Governs under: SPEC-BANKER-HOLY-SHIT-V1 Workstream B (revised scope)
```

---

## Addendum for Claude Code

**Critical reminders:**

1. **Diagnostic, not fix.** The deliverable is a finding doc. Even if you spot a one-line fix mid-investigation, file it as a recommendation in section 6, not a code change. Discipline matters here — the value of this PR is the finding's clarity, not how much code lands.

2. **Read-only.** No SQL mutations. No spread re-triggers. No route hits on Samaritus. PIV-2 reads current state; questions 1-3 read additional state. Nothing writes.

3. **Architecture summary is a guide, not gospel.** PIV-1 verifies it against `main`. If the actual code shape disagrees with the summary, trust the code and surface the divergence. The summary was drafted from a research pass — it may have small errors.

4. **Stop early when a question is conclusive.** If question 1 produces outcome 1D (the chain works for Samaritus today), don't investigate questions 2 or 3. Document that result in section 5 and move on. Conclusive simple findings beat thorough complicated ones.

5. **Section 6 fix options should be scoped.** Each option names: what code changes, estimated effort, what risk it carries, what it doesn't solve. "Rewrite the entire compute layer" is not a valid fix option for this diagnostic. "Add a missing call to enqueueSpreadRecompute after fact materialization" is.

6. **Section 7 (open questions) is a feature, not a failure.** If the investigation surfaces ambiguity that requires a different investigation to resolve, that's valuable. Document it. We may file a follow-up diagnostic.

7. **Estimated effort: 1-2 days.** The PIV reads should take an hour. Each question's investigation is 2-4 hours of reading + SQL + writing. The finding doc is 2-3 hours of synthesis. If you're approaching day 3 without a finding draft, surface to Matt — likely the diagnostic question shape is wrong and we need to recalibrate.

8. **The finding is what matters.** When you write the finding, write it for someone (Matt + Claude in chat) who has read this spec but not done the investigation themselves. They need to understand: what state we found, what it means, what the options are. Be specific. Cite SQL outputs. Cite line numbers. Make it impossible to disagree with the root cause.

9. **AAR includes the finding doc inline.** The AAR is the diagnostic's first reader. Paste section 5 (root cause) and section 6 (fix options) into the AAR so we can react without opening another file.

10. **The Holy Shit Spec governs sequencing.** After this finding lands and we pick a fix, the fix becomes Workstream B's actual scope. The original B1 (extraction, done) + B2 (auto-trigger, abandoned) + B3 (Classic Spread pre-render, deferred) + B4 (conservative methodology, deferred) sequencing is reframed by what this finding reveals.
