# Legacy Producer Burn-Down Ledger

> SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 26
>
> Tracks every quarantined legacy producer, its consumers, the finengine
> replacement, the cutover flag, reconciliation status, and deletion eligibility.
>
> **Safety rule 4 — nothing is deleted yet.** A producer becomes deletion-eligible
> ONLY after its reconciliation is clean, its cutover flag is live, tests prove
> replacement coverage, and a human performs the deletion in the final burn-down
> PR. Every entry below is currently **deletion-ineligible**.
>
> The machine-readable source of truth is
> [`src/lib/finengine/cutover/legacyBurndownLedger.ts`](../../src/lib/finengine/cutover/legacyBurndownLedger.ts);
> this document mirrors it. A unit test enforces that no entry can be marked
> deletion-eligible while its reconciliation is not clean.

## Ledger

| Producer | Legacy module | Consumers | finengine replacement | Cutover flag (default) | Reconciliation | Deletion eligible |
|---|---|---|---|---|---|---|
| `computeGlobalCashFlow` | `financialSpreads/*` (GCF compute) | gcf_route, snapshot_recompute, financial_readiness | `finengine/methods/global.ts` + `shadow/globalCashFlowAdapter.ts` | `ProducerFlags.computeGlobalCashFlow` (false) | in_progress | ❌ |
| `persistGlobalCashFlow` | `renderSpread.ts::persistGcfComputedFacts` | gcf_route, spreads_processor | `finengine/gcf/circularWriterGuard.ts` (kill switch) + certification writer | `GCF_CIRCULAR_WRITER_DISABLED` (enabled) + `FINENGINE_CERTIFICATION_WRITER_ENABLED` (off) | in_progress | ❌ |
| `computeTotalDebtService` | `financialSpreads/*` (ADS/debt service) | snapshot_recompute, spreads_processor, pricing_assumptions_route, financial_readiness | `finengine/cutover/ciTermDscrCutover.ts` | `ProductCutoverFlagMap.CI_TERM` (false) | in_progress | ❌ |
| `runCanonicalUnderwritingSynthesis` | underwriting synthesis route path | underwriting_synthesis_route | `finengine/memo/memoIntelligenceContract.ts` + officer/examiner engines | `ProducerFlags.runCanonicalUnderwritingSynthesis` (false) | not_started | ❌ |

## Circular writer

The `facts → rendered GCF spread → facts` circular writer
(`persistGcfComputedFacts`) is **quarantine-able** via the PR 19 kill switch
(`GCF_CIRCULAR_WRITER_DISABLED`, default enabled = current behavior). It is **not
deleted**; it is disabled behind the flag once the finengine GCF path is
reconciled.

## Deletion criteria (all must hold)

1. Reconciliation status = `clean` (no UNEXPECTED divergence — see the metric
   reconciliation matrix, PR 18).
2. Product / producer cutover flag live in production.
3. Tests prove replacement coverage for every consumer.
4. Human-approved in the final burn-down PR.

Until all four hold for a producer, it stays in this ledger with
`deletionEligible: false`.
