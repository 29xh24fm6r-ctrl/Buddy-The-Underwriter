# SPEC-LIB-DEDUP-2 Backlog — pairs skipped by SPEC-SYSTEM-DEBLOAT-1 Phase D

Phase D's hard rule: *"If any pair's merge would change a computed financial
value or touch `src/lib/spreads/` vs `financialIntelligence/` boundary → skip
pair, log to SPEC-LIB-DEDUP-2 backlog."* Entries below were investigated,
found to trip that rule, and left untouched — no files moved, no guard entry
added, nothing retired.

---

## `entity` / `entities` — skipped 2026-07-29

**Why this isn't a mechanical dedup like the other Batch 1 pairs:**

1. **Real type-name collision, not a duplicate.** Both directories export a
   type literally named `DealEntity`, but they are **structurally different
   shapes**:
   - `src/lib/entity/buildDealEntityGraph.ts::DealEntity` — a graph-analysis
     shape: `{ entityId, role, entityType, taxFormSignatures, fingerprint }`
     (camelCase, no DB row fields).
   - `src/lib/entities/types.ts::DealEntity` — a raw DB-row shape:
     `{ id, deal_id, user_id, name, entity_kind, legal_name, ein,
     ownership_percent, notes, meta, created_at, updated_at }` (snake_case,
     mirrors the `deal_entity_relationships`/entity tables).

   These are two genuinely different concepts sharing a name by accident,
   not a stale-vs-canonical pair. Consolidating them under one export would
   force every call site to agree on one shape — silently breaking whichever
   half currently relies on the other's fields, or requiring far more than
   the "preserve export names, update imports" scope this phase allows.

   (`EntityKind` in both files *is* the identical literal union
   `"OPCO" | "PROPCO" | "HOLDCO" | "PERSON" | "GROUP"` — that one type alone
   would be safe to dedupe, but doing so in isolation while leaving
   `DealEntity` split doesn't meaningfully reduce the duplication this phase
   targets.)

2. **`entities/types.ts` is financial-computation-adjacent.** It also
   exports `CombinedSpread` and `EntityFinancialPeriod`. `CombinedSpread` is
   directly imported and used by `src/lib/finance/combined/aggregate.ts` —
   a financial-statement aggregation module. Any restructuring here risks
   touching computed financial values, which the hard rule explicitly
   forbids for this phase.

**Recommendation for a future SPEC-LIB-DEDUP-2 pass:** this needs a real
design decision (which `DealEntity` shape is canonical, or whether they
should be two distinctly-named types instead of a directory merge), plus a
review of every one of `entity/`'s and `entities/`'s ~7+ importers against
`src/lib/finance/combined/aggregate.ts` and the spreads/financialIntelligence
boundary before any file moves — not a mechanical import-count-wins call.

---

## `extract` / `extraction` — skipped 2026-07-29

**Scale mismatch is itself a signal here:** `extraction/` is ~24 files —
the actively-developed, heavily-tested canonical document-extraction system
(Gemini structured-assist prompts, re-extraction orchestration, shadow mode,
`goldenCorpusRegression.test.ts`, `extractionInvariantGuard.test.ts`,
`institutionalGuard.test.ts`). `extract/` is 6 files, and every one of them
computes or routes financial values directly:

- `extract/financials.ts::extractFinancialsFromPdf` — parses a PDF into
  evidence + tables + confidence-scored **financial values**.
- `extract/financialsHybrid.ts::extractFinancialsHybrid`
- `extract/pipelines/financialsFromTokens.ts::buildFinancialsTablesFromTokens`
- `extract/router/extractByDocType.ts::extractFinancialsLegacy` — the
  "Legacy" naming here is exactly the shape of the financial/underwriting
  entanglement the spec's own non-goals section calls out (`financial*`
  dir families → future SPEC-LIB-DEDUP-2, "too entangled with
  Finengine/spreads boundary") — it just doesn't happen to have "financial"
  as its literal top-level directory name.

`extraction/`'s test suite (`goldenCorpusRegression`,
`extractionInvariantGuard`, `validationGateGuard`) directly references the
spreads/financialIntelligence boundary. Consolidating `extract/`'s financial-
value-producing functions into (or against) that system is precisely the
kind of change the hard rule exists to keep out of a mechanical de-bloat
phase — a wrong pick here could alter a computed financial value used in
underwriting.

**Recommendation for a future SPEC-LIB-DEDUP-2 pass:** treat `extract/`'s
6 files as part of the same financial/underwriting family review the spec
already deferred (`financial*` ×10, `underwriting*` ×5), not as a plain
directory-naming pair. Needs someone who owns the Finengine/spreads cutover
to confirm none of `extract/`'s functions are still live producers before
any consolidation.

---

## `score` / `scoring` — skipped 2026-07-29

**Both sides are underwriting-scoring-adjacent, not just one:**

- `score/` — the Buddy SBA Score pipeline (`buddySbaScore.ts`): loads
  inputs, evaluates SBA eligibility, runs five component scorers
  (`borrowerStrength`, `businessStrength`, `dealStructure`,
  `franchiseQuality`, `repaymentCapacity`), computes a weighted 0-100
  composite, and inserts via a `supersede`+insert RPC.
  `repaymentCapacity.ts`, `scoringCurves.ts`, and `inputs.ts` all reference
  DSCR directly.
- `scoring/` — 7 files of operational/meta scores (`actionabilityScore`,
  `bankerDominanceScore`, `borrowerUpliftScore`, `readinessScore`,
  `systemEfficiencyScore`, `trustWeightedScenarioScore`) that read as a
  different concept (deal/banker/system health, not credit risk) — **except**
  `dealScoringEngine.ts`, which computes a `DealScoreGrade` (`A`–`D`) from a
  `DealStressPayload` and is consumed by
  `src/app/api/deals/[dealId]/underwriting/score/recompute/route.ts` — i.e.
  it's also underwriting-scoring surface, not purely operational telemetry.

The two directories have zero cross-imports (verified — neither references
the other), so a "move `scoring/`'s files into `score/` untouched, don't
edit anything in `score/`" approach was considered as a lower-risk middle
ground. Rejected anyway: both directories sit inside the underwriting/
credit-scoring surface closely enough (SBA score composite on one side, an
underwriting-score-recompute-consumed grade on the other) that even a
no-edit file relocation carries more re-review risk than this phase's
"one concept per PR, mechanical rename" scope is meant to absorb. Skipping
is the conservative call, matching how `entity`/`entities` and
`extract`/`extraction` were handled above.

**Recommendation for a future SPEC-LIB-DEDUP-2 pass:** get sign-off from
whoever owns the Buddy SBA Score spec (`specs/brokerage/sprint-00-buddy-sba-score.md`,
referenced in `score/buddySbaScore.ts`'s header) before touching either
directory. `dealScoringEngine.ts` in particular needs a decision on whether
it belongs conceptually with `score/`'s credit-risk scorers or stays with
`scoring/`'s operational scores — that's a naming/ownership call, not a
mechanical merge.
