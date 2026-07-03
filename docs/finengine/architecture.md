# Buddy Finengine — Architecture

> SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 27
>
> This document describes the finengine credit-intelligence stack built across
> PRs 1–26. Every module is **pure** (no IO) unless noted; the only live-touch is
> the PR 19 GCF kill-switch guard (default-preserving). Every claim here is backed
> by a module + test in the [test matrix](./test-matrix.md).

## Layering

```
registry/            one canonical metric + fact-key + formula-alias + product-metric surface (PR1)
  ├─ metricRegistry     re-exports central METRIC_REGISTRY (single math source)
  ├─ factKeyRegistry    re-exports frozen fact-key vocabulary
  ├─ formulaRegistry    alias normalization (STANDARD-derived + supplemental)
  ├─ productMetricRegistry  required canonical metrics per product
  └─ registryAudit      drift / duplicated-source / alias-coverage reports

quality/             trust + earnings intelligence
  ├─ statementQuality   basis + assurance + staleness → quality score (PR3)
  └─ earnings*          recurring earnings, add-back evaluation, quality-adjusted EBITDA (PR4)

cashConversion/      DSO/DPO/DIO/CCC (delegated) + operating/free cash conversion, normalized FCF (PR5)

industry/            12-sector taxonomy: risk / benchmarks / stress / covenant guidance (PR6)

products/            common product contract + required docs/covenants/risk + missing-data blockers (PR7)

abl/                 AR/ABL borrowing base — eligible-collateral schedule (PR8)
cre/                 property intelligence — NOI/vacancy/rollover/LTV/DSCR (PR9)
construction/        S&U balance, contingency/reserve, cost-overrun stress (PR10)
sba/                 eligibility (existing) + EPC-OC/standby/guarantor/collateral/franchise (PR11)

examiner/            regulator-style criticisms with evidence + mitigants (PR12)
entityGraphIntelligence  relationship exposure roll-up + GCF bridge (PR13)
evidence/            supporting/contradicting/missing + confidence + WithEvidence<T> (PR14)
officer/             13 banker-grade concern types, ranked (PR15)
covenants/           full covenant taxonomy + four-state evaluation (PR16, extends existing)
portfolio/           concentration / migration / criticized / vintage / CECL hooks (PR17)

shadow/              metric-by-metric reconciliation matrix + intentional-divergence registry (PR18)
gcf/                 circular-writer kill switch (PR19, default enabled)
cutover/             producer seam (PR20) + product flags (PR21) + C&I DSCR candidate (PR25) + burn-down ledger (PR26)
memo/                certified memo contract (PR22) + classic memo shadow adapter (PR23)
certification/       gated certified-fact writer, disabled by default (PR24)
```

## One-engine invariants

1. **No duplicated formula systems.** All math routes through the central
   `METRIC_REGISTRY` via `evaluateMetric`; the registry package re-exports it.
   The registry audit reports any second source.
2. **Provenance always.** Statement quality, evidence bundles, and the
   certification writer carry source anchors / stamps. Quality conditions
   *confidence*, never the *value*.
3. **Legacy stays default.** Every cutover flag defaults false; the GCF writer
   defaults enabled; the certification writer defaults off.
4. **Divergence is classified.** The reconciliation matrix labels every metric
   diff intended / legacy-bug / finengine-bug / data-quality / quality-adjusted /
   unexpected; unexpected blocks cutover.

See [product-engine architecture](#product-engines) and
[SBA architecture](#sba-engine) below.

## Product engines

Each product compiles through the `ProductDefinition` contract (PR 7):
required metrics (from the PR 1 registry), required documents, recommended
covenant package, and risk factors. The AR/ABL (PR 8), CRE (PR 9), construction
(PR 10), and SBA (PR 11) engines deepen specific products. The missing-data
blocker system turns absent metrics/documents into actionable blockers.

## SBA engine

The native SBA eligibility engine (existing) is extended (PR 11) with EPC/OC
structure, standby-debt treatment, 20%+ guarantor requirements, discounted
collateral adequacy, insurance requirements, and franchise-directory hooks.
`assembleSbaIntelligence` emits blockers, required documents, and unresolved
determinations — and **never claims an approval** (`approvalClaim:
"NOT_AN_APPROVAL"`).
