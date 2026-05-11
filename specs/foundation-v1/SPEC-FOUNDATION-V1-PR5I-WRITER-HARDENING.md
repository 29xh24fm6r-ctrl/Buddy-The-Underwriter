# SPEC-FOUNDATION-V1-PR5I — Canonical Writer Hardening

**Status:** Draft, awaiting Matt approval before hand-off to Claude Code.
**Branch:** `feat/foundation-v1-pr5i-writer-hardening`
**Closes:** Reliability gap surfaced by PR5i research pass — canonical writers' roles are implicit, undocumented, and only traceable by cross-file data dependency analysis. This was the root cause of the false premise that the aggregator's `spreadsProcessor` call site was redundant cleanup.
**Type:** Hardening pass (not removal, not refactor).

---

## PIV (Problem, Invariant, Verification)

### Problem

PR5h closed the substrate arc structurally — all three OQs resolved, all five canonical writers produce clean single-row facts. But the architecture has a hidden fragility class that an audit-driven attempt to remove the aggregator's `spreadsProcessor` call site surfaced:

- **Writer roles are implicit.** Each writer's purpose, contract, and dependency on the other four can only be inferred by reading all five files together. No registry, no comment block, no test asserts the dependency chain.
- **"Redundant" cleanups are dangerous.** The aggregator's `spreadsProcessor` call site appears redundant if one inspects only owned fact_keys — every key it writes is also written elsewhere. The dependency analysis required to discover that it is the **cold-start bootstrap writer** for `CASH_FLOW_AVAILABLE` (because the GCF spread template reads, doesn't compute, that fact) is non-trivial.
- **Silent partial-success.** The aggregator's `console.warn` on missing NCADS candidates is invisible to operators. Downstream gaps (null DSCR, MISSING_PREREQ_NOI in `computeTotalDebtService`) are observable but not connected back to the bootstrap miss that caused them.
- **No invariant assertion at chain exit.** The canonical chain promises that on exit, certain fact_keys exist if certain inputs exist. Nothing checks the promise.
- **Provenance gaps.** `computeTotalDebtService` writes ADS / DSCR / DSCR_STRESSED_300BPS without populating `provenance.extractor`. Samaritus SQL check confirms `extractor: null` on the actual rows. Traceability is degraded.
- **Phantom null rows.** `backfillCanonicalFactsFromSpreads` writes null-valued rows for NET_INCOME (and likely others) when source data is missing. These rows coexist with real-valued rows from extraction at different `fact_period_end` values. The aggregator filters them via `fact_value_num IS NOT NULL`, but they remain noise in the table.

### Invariant (what the canonical chain promises)

After a successful spreadsProcessor run on a deal with the prerequisite raw inputs, the following must hold:

| Precondition | Postcondition |
|---|---|
| At least one of EBITDA / ORDINARY_BUSINESS_INCOME / NET_INCOME exists with `fact_value_num IS NOT NULL` | CASH_FLOW_AVAILABLE exists with `fact_value_num IS NOT NULL` |
| `deal_structural_pricing.annual_debt_service_est > 0` | ANNUAL_DEBT_SERVICE exists with `fact_value_num > 0` |
| CASH_FLOW_AVAILABLE exists AND ANNUAL_DEBT_SERVICE exists AND ANNUAL_DEBT_SERVICE > 0 | DSCR exists with `fact_value_num IS NOT NULL` |
| CASH_FLOW_AVAILABLE exists AND ANNUAL_DEBT_SERVICE exists | EXCESS_CASH_FLOW exists with `fact_value_num IS NOT NULL` |
| GCF spread rendered successfully (status='ready') | GCF_GLOBAL_CASH_FLOW, GCF_DSCR, GCF_CASH_AVAILABLE facts exist (per `persistGcfComputedFacts` contract) |
| At least one operating entity exists AND personal income facts exist | GLOBAL_CASH_FLOW (legacy) fact exists with `fact_value_num IS NOT NULL` |
| Any canonical writer writes a fact | `provenance.extractor` is populated |

These invariants are **observed, not enforced** in v1 — violations emit structured warnings; the chain still succeeds. Enforcement is a v2 conversation after a month of green observation data.

### Verification (V-N runtime, post-merge, after one worker cycle)

- V-1: `canonicalWriters.ts` registry exists with entries for all five writers, each entry includes `role`, `ownedFactKeys`, `bootstrapsForDownstream`, `reads`, `runsAfter`, `runsBefore`, `invariant`. tsc clean.
- V-2: Aggregator call site in `spreadsProcessor.ts` carries the named comment block explaining its bootstrap role. Comment includes "DO NOT REMOVE" sentinel string searchable via `git grep`.
- V-3: Aggregator emits `BOOTSTRAP_FAILED_CASH_FLOW_AVAILABLE` `writeSystemEvent` on `no_ncads_candidates` reason. Verified on a synthetic deal with no NCADS facts.
- V-4: `computeTotalDebtService` writes include `provenance.extractor: "computeTotalDebtService:v1"`. SQL check on Samaritus post-next-canonical-run confirms `extractor IS NOT NULL` for ANNUAL_DEBT_SERVICE / DSCR / DSCR_STRESSED_300BPS / ANNUAL_DEBT_SERVICE_PROPOSED / ANNUAL_DEBT_SERVICE_EXISTING / GCF_DSCR.
- V-5: `assertCanonicalChainInvariants` module exists and is called at end of `spreadsProcessor` canonical chain (before downstream readiness recompute). Returns `{ ok, violations[] }`. Emits one ledger event per run: `canonical.recompute.invariants_checked`, with `meta.violations` array.
- V-6: Synthetic test: deal with EBITDA but no aggregator call → invariant violation emitted with `error_code: "INVARIANT_BOOTSTRAP_MISSED"` and `expected_fact_key: "CASH_FLOW_AVAILABLE"`. (This is the regression test that would catch any future attempt to remove the aggregator call site.)
- V-7: Backfill writes are gated: rows with `fact_value_num: null` are SKIPPED, not written. SQL check confirms zero new null-valued FINANCIAL_ANALYSIS rows from `extractor LIKE 'backfillCanonicalFactsFromSpreads%'` after next worker cycle.
- V-8: Full test suite green. 5739+ tests pass (PR5h baseline + 8-12 new tests).
- V-9: Samaritus canonical chain run after merge produces zero invariant violations (all preconditions on Samaritus are met today; the chain should pass clean).

---

## Scope

### In scope

**1. Canonical writer registry.** New file `src/lib/financialFacts/canonicalWriters.ts`:

```typescript
export type WriterRole = "bootstrap" | "compute" | "propagate" | "persist_render";

export interface CanonicalWriterEntry {
  /** Module name, used for ledger meta.extractor populated by the writer. */
  name: string;
  /** Architectural role. */
  role: WriterRole;
  /** fact_keys this writer is contractually responsible for. */
  ownedFactKeys: string[];
  /** fact_keys this writer bootstraps for downstream consumers (i.e., is the only writer that can produce them in cold-start). */
  bootstrapsForDownstream: string[];
  /** What this writer reads to do its work. */
  reads: {
    factKeys?: string[];
    tables?: string[];
    spreadTypes?: string[];
  };
  /** Module names that must run before this writer in the canonical chain. */
  runsAfter: string[];
  /** Module names that must run after this writer in the canonical chain. */
  runsBefore: string[];
  /** Human-readable invariant. */
  invariant: string;
  /** If true, this writer is load-bearing — removing it breaks the chain. Do not delete. */
  loadBearing: boolean;
  /** Free-form notes for future engineers. */
  notes?: string;
}

export const CANONICAL_WRITERS: Record<string, CanonicalWriterEntry> = {
  runCashFlowAggregator: { /* … */ },
  backfillCanonicalFactsFromSpreads: { /* … */ },
  computeTotalDebtService: { /* … */ },
  persistGlobalCashFlow: { /* … */ },
  persistGcfComputedFacts: { /* … */ },
};
```

Populated with the writer roles documented in this spec's appendix.

**2. Aggregator call-site comment block.** Replace the existing terse comment at the aggregator call site in `src/lib/jobs/processors/spreadsProcessor.ts` with the explicit one in this spec's "Comment Block" appendix. Includes "DO NOT REMOVE" sentinel.

**3. Aggregator bootstrap-miss observability.** In `src/lib/financialFacts/runCashFlowAggregator.ts`, when result is `{ ok: false, reason: "no_ncads_candidates" }`, emit a structured `writeSystemEvent` (in addition to the existing return). The event:
- `event_type: "warning"`, `severity: "warning"`
- `error_code: "BOOTSTRAP_FAILED_CASH_FLOW_AVAILABLE"`
- `payload`: `{ dealId, bankId, candidatesChecked: ["EBITDA", "ORDINARY_BUSINESS_INCOME", "NET_INCOME"], impact: "DSCR computation will be skipped; memo will show null DSCR until raw NCADS facts exist" }`

Only emitted from the spreadsProcessor call path (not the route call path, which has its own UI affordances). The aggregator itself doesn't know which caller invoked it, so the call site in spreadsProcessor wraps the result handling.

**4. `provenance.extractor` for computeTotalDebtService.** Add `extractor: "computeTotalDebtService:v1"` to every `provenance` object in `src/lib/structuralPricing/computeTotalDebtService.ts`. Six write sites: ANNUAL_DEBT_SERVICE_PROPOSED, ANNUAL_DEBT_SERVICE_EXISTING, ANNUAL_DEBT_SERVICE, DSCR, GCF_DSCR, DSCR_STRESSED_300BPS.

**5. Chain-invariant assertion module.** New file `src/lib/financialFacts/assertCanonicalChainInvariants.ts`:

```typescript
export interface ChainInvariantViolation {
  invariantId: string;
  errorCode: string; // e.g. "INVARIANT_BOOTSTRAP_MISSED"
  precondition: string; // human-readable
  expectedPostcondition: string;
  actualState: Record<string, unknown>;
}

export async function assertCanonicalChainInvariants(args: {
  dealId: string;
  bankId: string;
}): Promise<{ ok: true } | { ok: false; violations: ChainInvariantViolation[] }>;
```

Implements the seven invariants from the PIV table. Reads the current state of `deal_financial_facts`, `deal_structural_pricing`, `deal_entities`, `deal_spreads`. Returns violations without throwing.

**6. Wire invariant assertion into spreadsProcessor.** After the existing PR5b `triggerCanonicalRecompute({ reason: "extraction_batch_complete" })` call, before the readiness recompute, call `assertCanonicalChainInvariants`. Emit a single `canonical.recompute.invariants_checked` ledger event with `meta.violations` array. Non-fatal: chain proceeds regardless.

**7. Backfill null-row gating.** In `src/lib/financialFacts/backfillFromSpreads.ts`, every write site that currently passes `factValueNum: <value> ?? null` becomes a conditional that SKIPS the write when the value is null. Reasoning: writing a null-valued canonical fact is never the correct behavior — it creates phantom rows that have to be filtered out by every downstream reader. Scope limited to backfill; aggregator, computeTotalDebtService, persistGlobalCashFlow, and persistGcfComputedFacts already skip null writes appropriately.

**8. Tests.** New test file `src/lib/financialFacts/__tests__/canonicalChainInvariants.test.ts`. Eight tests minimum:
- Bootstrap test: fresh deal with raw EBITDA only → invariant 1 passes; CASH_FLOW_AVAILABLE exists after chain run
- Bootstrap test: fresh deal with NET_INCOME only → invariant 1 passes; CASH_FLOW_AVAILABLE exists
- Bootstrap-miss test: fresh deal with no NCADS facts → invariant 1 violated; BOOTSTRAP_FAILED_CASH_FLOW_AVAILABLE event emitted; chain still succeeds
- Aggregator-removed regression test: stub aggregator call to no-op → invariant 1 violated; INVARIANT_BOOTSTRAP_MISSED emitted; **this test exists specifically to catch any future attempt to remove the aggregator's spreadsProcessor call site**
- Chain order test: aggregator runs before computeTotalDebtService (asserts via call-order spy)
- Provenance test: all canonical writes carry `provenance.extractor`
- Backfill null-gate test: backfill of a spread with null CASH_FLOW_AVAILABLE row does not insert a null-valued canonical fact
- Invariant assertion module unit tests: each invariant validated independently with synthetic state

### Out of scope (for v1)

- Enforcement of invariants (refusing to proceed on violation). Observed-only in v1. Promotion to enforcement is a v2 conversation after a month of clean observation data.
- Removing the aggregator's `spreadsProcessor` call site. The research pass established it is load-bearing for first-run deals; the registry codifies this; the call site stays.
- Removing the aggregator module itself. Used by both the route and the spreadsProcessor; module stays.
- Removing the route's aggregator call. PR5c finding stands: defense-in-depth.
- Migration of canonical state for existing deals. The hardening is forward-looking; the invariant assertion will surface existing-deal gaps as warnings in the ledger, which is the desired observability outcome.
- Changes to `computeDscrGlobal` (memo read path). The read side is intentionally out of scope; this PR is strictly write-side hardening.
- Changes to the GCF spread template. The chicken-and-egg between the template reading CASH_FLOW_AVAILABLE and backfill writing it is now documented in the registry; structural refactor of the read pattern is a future architectural conversation.

### Hard non-goals

- **Do not delete the aggregator's `spreadsProcessor` call site.** The research pass concluded it is the cold-start bootstrap writer for CASH_FLOW_AVAILABLE. The new test in V-6 exists to catch any deletion attempt.
- **Do not delete the `runCashFlowAggregator` module.** Used by route + spreadsProcessor.
- **Do not change `runCashFlowAggregator`'s computation logic.** Only add the wrapper-level observability at the call site.
- **Do not introduce enforcement** (i.e., do not make the invariant assertion block the chain or fail the job). Observed-only.
- **Do not modify the canonical chain's call order in spreadsProcessor.** Order stays: backfill → aggregator → computeTotalDebtService → persistGlobalCashFlow → second GCF render → triggerCanonicalRecompute → invariant assertion (new tail position).
- **Do not modify the route's aggregator call site or the route's snapshot rebuild logic.** Out of scope.
- **Do not change writer signatures.** Adding `extractor` field to provenance objects is the only allowed write-side change; otherwise no signature drift.
- **Do not migrate or backfill historical data.** Phantom null rows from before this PR remain; the gating fix is forward-looking.

---

## Tests

See V-N entries above. Additional integration test:

- **Samaritus regression check (manual V-9):** After merge, on next natural worker cycle for Samaritus, query `deal_events` for `kind = 'canonical.recompute.invariants_checked'` for `deal_id = '0279ed32-c25c-4919-b231-5790050331dd'`. Expected: one event per canonical chain run with `meta.violations = []`. If any violations appear, flag in a follow-up issue but do not revert PR5i.

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Invariant module reads stale state due to write-then-read race within same job | Medium | Low | Invariant assertion runs after `await Promise.all(writes)` in each writer; all writes complete before the assertion query fires. PostgreSQL read-after-write within same connection is consistent. |
| Backfill null-gate changes a downstream reader's behavior (some consumer expected the null row to exist) | Low | Medium | Searched for consumers of FINANCIAL_ANALYSIS facts where extractor is `backfillCanonicalFactsFromSpreads%` and value is null — none found. All consumers filter `fact_value_num IS NOT NULL` or `is_superseded = false`. Mitigation: ship behind a feature flag `BACKFILL_NULL_GATE_ENABLED` defaulting to `true`; can be flipped off without redeploy if a reader breaks. |
| `writeSystemEvent` for BOOTSTRAP_FAILED creates noise on legitimate-empty deals (deals that don't have NCADS facts yet because extraction is incomplete) | Medium | Low | Aegis events are operational telemetry; volume is fine. The signal is "extraction did not produce NCADS facts" — exactly what operators need to triage incomplete deals. |
| Invariant assertion adds latency to spreadsProcessor | Low | Low | Single SELECT against `deal_financial_facts` with deal_id filter; observed P95 < 100ms. Chain already takes minutes; this is noise. |
| PR5d ledger events not flowing to deal_events on Samaritus (discovered during research pass) | Known issue | Low | Out of scope for PR5i; flagged for a follow-up `canonical.recompute` observability fix. PR5i does not depend on PR5d events being visible — `canonical.recompute.invariants_checked` is a new event key and will route the same way the others should. If PR5i's event also doesn't show up post-merge, the followup investigation gets both signals at once. |
| Future engineer reads the "DO NOT REMOVE" comment and removes it anyway | Low | Critical | Three-layer defense: (1) comment block, (2) registry entry with `loadBearing: true`, (3) regression test in V-6 that fails CI if the call site is removed. |

---

## Hand-off commit message

Suggested for the PR5i merge commit (when Claude Code finishes implementation):

```
feat(foundation-v1): PR5i canonical writer hardening — observed invariants

Hardens the canonical compute substrate without removing any writer.
Codifies the five canonical writers' roles, contracts, and dependencies
in a single registry. Adds chain-exit invariant assertion (observed,
not enforced). Closes provenance gaps. Eliminates phantom null rows
from backfill. Adds regression test that catches any future attempt
to remove the aggregator's spreadsProcessor call site.

The aggregator is NOT redundant cleanup — it is the cold-start
bootstrap writer for CASH_FLOW_AVAILABLE. The GCF spread template
reads (does not compute) CASH_FLOW_AVAILABLE; backfill propagates
what the spread shows; only the aggregator can produce the fact from
raw NCADS in a fresh deal. This is now permanently documented in
src/lib/financialFacts/canonicalWriters.ts and asserted by a
regression test.

Closes the substrate arc. Build Principle #14: every canonical
writer registers role/contract/invariants; chain asserts those
invariants on exit; silent gaps in canonical state are forbidden.

Files touched:
- src/lib/financialFacts/canonicalWriters.ts (NEW)
- src/lib/financialFacts/assertCanonicalChainInvariants.ts (NEW)
- src/lib/financialFacts/__tests__/canonicalChainInvariants.test.ts (NEW)
- src/lib/jobs/processors/spreadsProcessor.ts (comment block + invariant call)
- src/lib/financialFacts/runCashFlowAggregator.ts (BOOTSTRAP_FAILED event at call site wrapper)
- src/lib/structuralPricing/computeTotalDebtService.ts (provenance.extractor)
- src/lib/financialFacts/backfillFromSpreads.ts (null-write gating)

Refs: SPEC-FOUNDATION-V1-PR5I-WRITER-HARDENING
```

---

## Addendum for Claude Code

**Read-before-coding checklist:**

1. Read this spec end-to-end.
2. Read `src/lib/financialFacts/runCashFlowAggregator.ts` at HEAD — understand the NCADS fallback chain.
3. Read `src/lib/jobs/processors/spreadsProcessor.ts` lines covering the canonical chain (after `backfillCanonicalFactsFromSpreads` call through `triggerCanonicalRecompute` call) — understand where the new invariant assertion is wired.
4. Read `src/lib/structuralPricing/computeTotalDebtService.ts` — six provenance objects to update.
5. Read `src/lib/financialFacts/backfillFromSpreads.ts` — every write site needs the null-gate.
6. Read the GCF spread template `src/lib/financialSpreads/templates/globalCashFlow.ts` to confirm the chicken-and-egg dependency described in the spec is accurate before populating the registry's notes field.

**Implementation order (recommended):**

1. Create `canonicalWriters.ts` registry first. This is documentation-as-code; it forces the writer's contract into a single auditable surface before any code change.
2. Add `assertCanonicalChainInvariants.ts` with the seven invariants. Unit test in isolation first (synthetic state, no DB).
3. Wire the assertion into `spreadsProcessor.ts` at the new tail position.
4. Add the BOOTSTRAP_FAILED `writeSystemEvent` at the aggregator call-site wrapper (in `spreadsProcessor.ts`, not in `runCashFlowAggregator.ts` itself — the aggregator module stays untouched).
5. Add `extractor` field to all six provenance objects in `computeTotalDebtService.ts`.
6. Add null-write gating to `backfillFromSpreads.ts`. Behind feature flag `BACKFILL_NULL_GATE_ENABLED` defaulting to `true`.
7. Replace the existing comment block at the aggregator call site in `spreadsProcessor.ts` with the named "DO NOT REMOVE" block. Include the sentinel string `BOOTSTRAP-WRITER-DO-NOT-REMOVE` searchable via `git grep`.
8. Write the eight tests in `canonicalChainInvariants.test.ts`. The aggregator-removed regression test (V-6) is the critical one — it must FAIL CI if anyone removes the aggregator call site.
9. Run full test suite. Confirm 5739 + 8 = 5747 tests pass.
10. Run tsc. Clean.
11. Open PR against `main`. PR description points at this spec.

**AAR requirements:**
- Verification command for each V-N item.
- SQL output from Samaritus post-merge-and-one-worker-cycle showing `extractor IS NOT NULL` for the six `computeTotalDebtService` fact_keys.
- File-existence verification via `git show HEAD:<path>` for the three new files.
- Confirmation that the regression test in V-6 actually fails when the aggregator call site is removed (i.e., temporarily stub it, run the test, confirm RED, restore, run the test, confirm GREEN).
- Explicit acknowledgment of the hard non-goals; if any were violated (PR5h precedent), call it out in an exceptions section.

---

## Appendix A: Canonical writer registry contents

For each writer, the registry entry to populate:

### runCashFlowAggregator

```typescript
runCashFlowAggregator: {
  name: "runCashFlowAggregator",
  role: "bootstrap",
  ownedFactKeys: [
    "ANNUAL_DEBT_SERVICE",
    "DSCR",
    "CASH_FLOW_AVAILABLE",
    "EXCESS_CASH_FLOW",
  ],
  bootstrapsForDownstream: ["CASH_FLOW_AVAILABLE"],
  reads: {
    factKeys: ["EBITDA", "ORDINARY_BUSINESS_INCOME", "NET_INCOME"],
    tables: ["deal_structural_pricing"],
  },
  runsAfter: ["backfillCanonicalFactsFromSpreads"],
  runsBefore: ["computeTotalDebtService"],
  invariant:
    "On successful exit, CASH_FLOW_AVAILABLE fact exists for the deal IF at least one of EBITDA/OBI/NET_INCOME exists with a non-null value.",
  loadBearing: true,
  notes:
    "BOOTSTRAP-WRITER-DO-NOT-REMOVE. " +
    "The GCF spread template (globalCashFlow.ts) READS the canonical CASH_FLOW_AVAILABLE fact rather than computing it from raw inputs. " +
    "backfillCanonicalFactsFromSpreads reads the GCF spread's rendered_json. " +
    "Therefore on a fresh deal's first canonical chain run, only this writer can produce CASH_FLOW_AVAILABLE — without it, " +
    "backfill propagates null, computeTotalDebtService skips DSCR with MISSING_PREREQ_NOI, and the chain cannot recover. " +
    "On steady-state runs (CASH_FLOW_AVAILABLE already exists from a prior run), the role is technically redundant with backfill, " +
    "but the cold-start bootstrap role makes the writer load-bearing. " +
    "Also called from the classic-spread route as defense-in-depth (banker-initiated PDF generation path).",
}
```

### backfillCanonicalFactsFromSpreads

```typescript
backfillCanonicalFactsFromSpreads: {
  name: "backfillCanonicalFactsFromSpreads",
  role: "propagate",
  ownedFactKeys: [
    "CASH_FLOW_AVAILABLE", "ANNUAL_DEBT_SERVICE", "DSCR",
    "DSCR_STRESSED_300BPS", "EXCESS_CASH_FLOW",
    "NOI_TTM", "TOTAL_INCOME_TTM", "OPEX_TTM",
    "REVENUE", "COGS", "GROSS_PROFIT", "EBITDA", "NET_INCOME",
    "IN_PLACE_RENT_MO", "OCCUPANCY_PCT", "VACANCY_PCT",
    "TOTAL_ASSETS", "TOTAL_LIABILITIES", "NET_WORTH",
    "WORKING_CAPITAL", "CURRENT_RATIO", "DEBT_TO_EQUITY",
    "PERSONAL_TOTAL_INCOME",
    "PFS_TOTAL_ASSETS", "PFS_TOTAL_LIABILITIES", "PFS_NET_WORTH",
    "GCF_GLOBAL_CASH_FLOW", "GCF_DSCR",
  ],
  bootstrapsForDownstream: [],
  reads: {
    spreadTypes: [
      "GLOBAL_CASH_FLOW", "T12", "RENT_ROLL", "BALANCE_SHEET",
      "PERSONAL_INCOME", "PERSONAL_FINANCIAL_STATEMENT",
    ],
  },
  runsAfter: ["all spread renders"],
  runsBefore: ["runCashFlowAggregator"],
  invariant:
    "On exit, every fact written has fact_value_num != null. " +
    "Null-valued source data is SKIPPED (gated by BACKFILL_NULL_GATE_ENABLED flag, default true).",
  loadBearing: true,
  notes:
    "Propagates rendered spread values back into the canonical facts table so " +
    "downstream consumers (memo, snapshot, advisor) can read them without re-rendering spreads. " +
    "Note: does NOT bootstrap CASH_FLOW_AVAILABLE on cold-start deals because the GCF spread template " +
    "reads the fact rather than computes it — chicken-and-egg. See runCashFlowAggregator.notes.",
}
```

### computeTotalDebtService

```typescript
computeTotalDebtService: {
  name: "computeTotalDebtService",
  role: "compute",
  ownedFactKeys: [
    "ANNUAL_DEBT_SERVICE_PROPOSED",
    "ANNUAL_DEBT_SERVICE_EXISTING",
    "ANNUAL_DEBT_SERVICE",
    "DSCR",
    "GCF_DSCR",
    "DSCR_STRESSED_300BPS",
  ],
  bootstrapsForDownstream: [],
  reads: {
    factKeys: ["CASH_FLOW_AVAILABLE", "GCF_GLOBAL_CASH_FLOW"],
    tables: ["deal_structural_pricing", "deal_existing_debt_schedule"],
  },
  runsAfter: ["runCashFlowAggregator"],
  runsBefore: ["persistGlobalCashFlow"],
  invariant:
    "On exit with proposed > 0: ANNUAL_DEBT_SERVICE_PROPOSED, ANNUAL_DEBT_SERVICE, ANNUAL_DEBT_SERVICE_EXISTING " +
    "(if existing debt rows present) all exist with non-null values. " +
    "DSCR exists iff CASH_FLOW_AVAILABLE was non-null at read time (graceful degradation via MISSING_PREREQ_NOI otherwise).",
  loadBearing: true,
  notes:
    "Aggregates proposed (from deal_structural_pricing) + existing (from deal_existing_debt_schedule) into total ADS. " +
    "Computes DSCR using the canonical CASH_FLOW_AVAILABLE fact (which the aggregator wrote upstream). " +
    "On null CASH_FLOW_AVAILABLE: emits MISSING_PREREQ_NOI warning via writeEvent, skips DSCR, still writes ADS facts. " +
    "Writes carry provenance.extractor: 'computeTotalDebtService:v1' (added in PR5i).",
}
```

### persistGlobalCashFlow

```typescript
persistGlobalCashFlow: {
  name: "persistGlobalCashFlow",
  role: "compute",
  ownedFactKeys: ["GCF_GLOBAL_CASH_FLOW", "GCF_DSCR", "GLOBAL_CASH_FLOW"],
  bootstrapsForDownstream: [],
  reads: {
    factKeys: [
      "NOI_TTM", "EBITDA", "CASH_FLOW_AVAILABLE", "ANNUAL_DEBT_SERVICE",
      "ANNUAL_DEBT_SERVICE_PROPOSED", "ANNUAL_DEBT_SERVICE_EXISTING",
      "TOTAL_PERSONAL_INCOME", "PFS_ANNUAL_DEBT_SERVICE", "PFS_LIVING_EXPENSES",
      "DEPRECIATION",
    ],
    tables: ["deal_entities"],
  },
  runsAfter: ["computeTotalDebtService"],
  runsBefore: ["second GCF render (PR5g)"],
  invariant:
    "On exit with at least one operating entity AND non-null entity netIncome: " +
    "GCF_GLOBAL_CASH_FLOW, GCF_DSCR, GLOBAL_CASH_FLOW facts all exist with non-null values. " +
    "Otherwise: facts may be null (preserved for legacy compat).",
  loadBearing: true,
  notes:
    "Calls the pure computeGlobalCashFlow() function with entity + sponsor inputs from the DB. " +
    "Writes GLOBAL_CASH_FLOW (legacy key) for backward compat in addition to GCF_GLOBAL_CASH_FLOW. " +
    "Entity netIncome fallback chain: NOI_TTM → EBITDA → CASH_FLOW_AVAILABLE — soft dependency on aggregator's bootstrap.",
}
```

### persistGcfComputedFacts

```typescript
persistGcfComputedFacts: {
  name: "persistGcfComputedFacts",
  role: "persist_render",
  ownedFactKeys: ["GCF_GLOBAL_CASH_FLOW", "GCF_DSCR", "GCF_CASH_AVAILABLE"],
  bootstrapsForDownstream: [],
  reads: {
    spreadTypes: ["GLOBAL_CASH_FLOW"],
  },
  runsAfter: ["GLOBAL_CASH_FLOW renderSpread"],
  runsBefore: ["next canonical chain step (within spreadsProcessor)"],
  invariant:
    "On exit, for each PERSIST_KEY whose rendered row has a non-null numeric value: " +
    "the corresponding canonical fact exists with that value.",
  loadBearing: true,
  notes:
    "Fire-and-forget from renderSpread. Persists rendered GCF metrics back to canonical facts " +
    "so Standard spread, snapshot, and memo can reference them without re-computing. " +
    "Overlap with persistGlobalCashFlow on GCF_GLOBAL_CASH_FLOW and GCF_DSCR is intentional: " +
    "this writer captures render-time computed values; persistGlobalCashFlow captures pure-function computed values. " +
    "Last-writer-wins on shared keys; both writers run within the same canonical chain.",
}
```

---

## Appendix B: Comment block for the aggregator call site

Replace the existing comment at the aggregator call site in `src/lib/jobs/processors/spreadsProcessor.ts` with:

```typescript
// ─────────────────────────────────────────────────────────────────────
// BOOTSTRAP-WRITER-DO-NOT-REMOVE
//
// SPEC-FOUNDATION-V1 PR5i — Cold-start bootstrap writer for CASH_FLOW_AVAILABLE.
//
// This call is NOT redundant cleanup. It is load-bearing.
//
// Why it is load-bearing:
//
// 1. The GLOBAL_CASH_FLOW spread template (globalCashFlow.ts) READS the
//    canonical CASH_FLOW_AVAILABLE fact rather than computing it from raw
//    inputs.
//
// 2. backfillCanonicalFactsFromSpreads READS the GLOBAL_CASH_FLOW spread's
//    rendered_json and propagates values back to canonical facts.
//
// 3. Therefore, on a fresh deal's first canonical chain run, no writer
//    upstream of the aggregator can produce CASH_FLOW_AVAILABLE. The GCF
//    spread renders with cfa=null because the fact does not exist yet;
//    backfill propagates the null; computeTotalDebtService skips DSCR with
//    MISSING_PREREQ_NOI.
//
// 4. The aggregator reads EBITDA / ORDINARY_BUSINESS_INCOME / NET_INCOME
//    directly from deal_financial_facts (extraction-written) and computes
//    CASH_FLOW_AVAILABLE from them. It is the ONLY writer in the canonical
//    chain that can do this on cold-start.
//
// 5. The route's aggregator call (in /api/deals/[dealId]/classic-spread/route.ts)
//    is defense-in-depth for banker-initiated PDF generation, NOT a substitute
//    for this call. Deals never touched by the route would have null
//    CASH_FLOW_AVAILABLE indefinitely without this call site.
//
// What protects this call from removal:
//
// - This comment block.
// - canonicalWriters.ts registry entry: loadBearing: true.
// - Regression test in canonicalChainInvariants.test.ts: stubbing this
//   call to no-op causes the test to FAIL with INVARIANT_BOOTSTRAP_MISSED.
//
// If you are reading this comment and considering removing this call,
// STOP. Read the registry. Read the regression test. Read SPEC-FOUNDATION-V1-PR5I.
// The substrate has been hardened against this exact removal attempt.
// ─────────────────────────────────────────────────────────────────────
```

---

## Build Principle #14 (codified by this PR)

**Every canonical writer registers its role, contract, and invariants in `canonicalWriters.ts`. The canonical chain asserts those invariants on exit via `assertCanonicalChainInvariants`. Silent gaps in canonical state are forbidden — every violation emits a structured warning to the ledger. Writers marked `loadBearing: true` cannot be removed without a spec PR that proves the chain still satisfies its invariants without them.**

---

## Closing note

This spec completes the substrate arc that began with PR5a. The substrate is now:

1. Self-sufficient (PR5f closed backfill)
2. Self-healing across-job (PR5b recompute triggers)
3. Self-healing within-job (PR5g second render)
4. Observable (PR5d ledger events)
5. Deduplicated (PR5h period_end alignment)
6. **Self-documenting and self-asserting (PR5i)** ← this PR

After merge, the next work is A1: SPEC-12.1 trust language. The substrate's role moves from "active construction zone" to "foundation we build upon."
