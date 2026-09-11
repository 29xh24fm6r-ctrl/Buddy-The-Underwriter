# Buddy consolidation implementation checkpoint — 2026-09-11

Owner: Codex. Baseline: `df4fe5cef72341643ec5dccd92b042a4015765ff` (main through PR #1079).

## Delivered baseline

- #1077: financial validation query failures block readiness; model income basis is explicit; the renderer's GCF fact writer is removed; structure policy reads the registry.
- #1078: committee retrieval uses the governed AI role boundary.
- #1079: stage 9 delegates package generation to the governed factory and checks persistence failures.

These are specific repairs, not certification that the full audit is resolved.

## This change: financial selection and consumer agreement

| Boundary | Implementation | Result |
| --- | --- | --- |
| Numeric fact lifecycle | `src/lib/financialFacts/acceptance.ts` | Shared exclusion of superseded, rejected, system-invalidated, missing and non-finite observations. Zero remains a valid value. |
| Selection consumers | Classic certification, canonical financial analysis, canonical GCF, finengine input adapter and selection validator | Retired observations cannot win simply because no active observation remains. Financial Analysis no longer revives a value that certification rejected. |
| Entity partition | Finengine period snapshots, metric cells and series | Business A and Business B stay separate even when keys and periods match. Unassigned observations do not fill a named entity's missing inputs. |
| Memo bridge | `spreadMemo.ts`, `finengineMemoPackage.ts` | Entity-specific sections retain their identity. An unscoped scalar metric list is unavailable when multiple entities exist. Risk enrichment cannot pick the first entity's ratio. |
| Validation | `validateSpread.ts` | Comparisons carry entity identity; anchors and registered exceptions cannot silently cross entities. Zero comparisons cannot clear finalization. |
| Readiness API | GET `/api/deals/[dealId]/readiness` | Legacy and structured response fields come from the same unified evaluation. GET disables explicit reconciliation and self-heal options; explicit refresh/submission remain their activation paths. |
| Loaders | Canonical GCF and finengine memo fact projections | Preserve resolution status and owner identity through I/O, including period start for finengine. |

This centralizes the lifecycle eligibility predicate. Source ranking, reconciliation, aggregate calculation, and all financial engines have **not** yet been unified. A selectable fact is not automatically an underwriter-approved fact.

## Behavioral verification

The focused suite passes 529 tests, including existing classic-spread certification and finengine fixtures. New tests exercise actual selectors, spread generation, memo generation, validation and route responses:

- rejected and superseded inputs remain excluded across selectors;
- zero survives; null, NaN and infinities do not;
- same-period entities remain separate;
- unassigned facts cannot complete another entity's ratio;
- growth is not computed between different businesses;
- memo sections and validation anchors retain entity identity;
- an exception for one entity cannot excuse another's divergence;
- an empty accepted evidence set cannot clear a memo;
- legacy and structured readiness responses agree, including evaluation failure.

Full TypeScript no-emit checking passes. Lint of the changed files reports zero errors (two warnings). The broad local unit run did not complete: its execution session ended after automatic approval review timed out, so no repository-wide pass is claimed. The environment runs Node 24; CI must additionally check its configured runtime. No production financial records or tenant activation flags were changed.

Matt authorized publishing this checkpoint to `29xh24fm6r-ctrl/Buddy-The-Underwriter` and opening the next PR. The earlier approval block is resolved; repository CI and mergeability must be checked before merge.

## Next connected migrations

1. **Snapshot writer/reader cutover.** `runSnapshotBuildPipeline` still has no production caller. Requiring v2-only validation before wiring the producer would strand existing v1 deals. Connect production build, evidence review, atomic activation, freshness and readers in one migration; preserve history and verify rollback. Do not describe the current fallback as a completed single-snapshot authority.
2. **Computation authority.** Finish income-basis-aware shared EBITDA; implement distinct operating/global/proposed coverage definitions with explicit debt-service composition; retire the remaining runtime spread-to-fact backfills. Verify behavioral fixtures before removing replaced engines.
3. **Multi-entity consumers.** Remaining shadow GCF/stress/reconciliation harnesses assume one entity per scope. Migrate them to an explicit entity graph or reject unsupported inputs before using them as cutover evidence. Financial Analysis's personal scalar fields and remaining model/UI loaders also need explicit owner semantics.
4. **Durable orchestration.** Unify processing/research admission, retries, completion and stage advancement. The research planner's detached execution and single-mission index handling remain open findings.
5. **Output and retirement.** Connect accepted facts, rules, questions, research and final package versions through the chosen contract. Remove the superseded writers/routes only after supported user journeys pass.

The Atlanta Ceramic/OmniCare source folders and the two hand-built workbooks have not been replayed in this checkpoint. Existing checked-in fixtures are useful regressions, not a substitute for that acceptance run. Database activation, complete end-to-end package correctness, and elimination of all 31 duplication families remain unverified.

## Next checkpoint after merged #1081: financial authority and real rebuild

Baseline: `7955a9db4366bfab0c23b6859ed1e6279b0c881a` (main with #1081 merged).

- The model engine and classic spread now call the shared conservative EBITDA engine. C-corp book income receives the available tax-provision add-back; amortization is retained; ordinary/taxable income does not add tax twice. Explicit zero tax is valid evidence. Revenue alone cannot become EBITDA by treating missing expenses as zero. The model excludes rejected, superseded, system-invalidated and non-finite facts before calculation.
- The snapshot recompute handler no longer labels an unknown business a C-corp merely because it has a generic business tax return. The source-text test enforcing that incorrect inference was removed.
- The rebuild button invokes the existing authenticated snapshot recompute handler, including actual persistence, and propagates its success or failure. It no longer calls only readiness and returns a fictitious acceptance. This reuses the existing orchestrator; it does not add another snapshot builder.
- `financial_snapshots` is the production immutable snapshot authority for validation and lifecycle gates. The validation API and gap/workbench API use the same loader and gate. The disconnected v2 table and the unrelated truth snapshot count no longer determine those surfaces. Historical rows and v2 modules/tables are preserved pending their separate retirement and data inventory.
- Snapshot generation records an input-fact fingerprint. The gate compares current inputs, blocks changed/rejected/reassigned evidence, checks snapshot completeness and open blocking gaps, and fails closed on read errors. Construction and comparison share a paginated fact loader. The known stress output written by this same computation is excluded from its own input fingerprint, preventing self-invalidation.
- The workbench uses the server gate for its badge and displays rebuild/load failures. Required-key review counts use distinct keys rather than duplicate fact rows.
- Two text guards enforcing v2-first/fallback source code are replaced by behavioral tests. New tests cover hand-calculated EBITDA, route delegation/error propagation, validation/lifecycle agreement, malformed/incomplete snapshots, stale evidence, tenant scoping, paginated inputs and database failure.

**Rollout behavior:** Existing snapshots without an input fingerprint require a real rebuild before this financial committee gate can pass. No database migration or production-record mutation is performed by this code change. Low-confidence gaps remain advisory under the existing committee policy; this change does not silently tighten that rule.

**Verification before PR:** 716 tests across the focused financial suites pass (the added pagination case replaces the removed assertion that generic business returns imply C-corp status); TypeScript no-emit and client API-reference checking pass. CI must verify the repository-wide suite and build on its configured Node versions.

**Still open:** Fact-review POSTs/UI still mix canonical fact IDs and v2 snapshot fact IDs and need an actual accepted-fact review transaction; immutable snapshot/decision pair persistence needs atomicity; direct rent-roll, loan-term and policy changes need their own snapshot dependency/freshness contracts. The legacy recompute handler retains runtime backfill paths. Consolidated snapshot reading does not certify those computations. Global/proposed/operating DSCR definitions, remaining GCF writers, output adapters, entity semantics in the model engine, orchestration and full deal-folder acceptance remain part of the broader build.

The audit's proposed-only aggregator warning was rechecked: current code already writes `PROPOSED_LOAN_COVERAGE` separately and leaves total debt-service DSCR to structural pricing. Do not re-add existing debt in the aggregator and create double counting.
