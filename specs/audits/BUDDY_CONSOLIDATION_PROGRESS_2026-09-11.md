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
