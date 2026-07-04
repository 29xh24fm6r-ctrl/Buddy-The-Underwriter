# Finengine Build-Arc Test Matrix

> SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 27
>
> The machine-readable source is
> [`src/lib/finengine/docs/testMatrix.ts`](../../src/lib/finengine/docs/testMatrix.ts).
> A unit test ([`finengineDocs.test.ts`](../../src/lib/finengine/__tests__/finengineDocs.test.ts))
> asserts every test file below exists on disk — so this table cannot drift from
> the code.

| PR | Title | Test file |
|---|---|---|
| 1 | Registry Consolidation Foundation | `registryConsolidation.test.ts` |
| 2 | Standard Spread Shadow Adapter | `standardShadowAdapter.test.ts` |
| 3 | Financial Statement Quality Engine | `statementQuality.test.ts` |
| 4 | Earnings Quality Engine | `earningsQuality.test.ts` |
| 5 | Cash Conversion Engine | `cashConversion.test.ts` |
| 6 | Industry Intelligence Engine | `industryIntelligenceEngine.test.ts` |
| 7 | Product Intelligence Framework | `productFramework.test.ts` |
| 8 | AR/ABL Borrowing Base Engine | `borrowingBase.test.ts` |
| 9 | CRE Property Intelligence Engine | `crePropertyIntelligence.test.ts` |
| 10 | Construction Loan Intelligence Engine | `constructionIntelligence.test.ts` |
| 11 | SBA 7(a)/504 Intelligence Engine | `sbaIntelligence.test.ts` |
| 12 | Examiner Criticism Engine | `examinerCriticism.test.ts` |
| 13 | Relationship / Entity Graph Intelligence | `entityGraphIntelligence.test.ts` |
| 14 | Evidence Engine | `evidenceEngine.test.ts` |
| 15 | Credit Officer Brain | `creditOfficerBrain.test.ts` |
| 16 | Covenant Recommendation & Monitoring Engine | `covenantEngine.test.ts` |
| 17 | Portfolio Intelligence Layer | `portfolioIntelligence.test.ts` |
| 18 | Shadow Reconciliation Matrix Expansion | `metricReconciliationMatrix.test.ts` |
| 19 | GCF Circular Writer Kill Switch | `gcfCircularWriterGuard.test.ts` |
| 20 | Legacy Producer Consumer Migration Plan | `legacyProducerAdapters.test.ts` |
| 21 | Product-by-Product Cutover Flags | `productCutoverFlags.test.ts` |
| 22 | Memo Intelligence Contract | `memoIntelligenceContract.test.ts` |
| 23 | Classic Spread / Memo Shadow Adapter | `classicMemoShadowAdapter.test.ts` |
| 24 | Finengine Certification Writer | `certificationWriter.test.ts` |
| 25 | First Safe Product Cutover Candidate | `ciTermDscrCutover.test.ts` |
| 26 | Legacy Burn-Down Ledger | `legacyBurndownLedger.test.ts` |
| 27 | Documentation & Operator Evidence | `finengineDocs.test.ts` |

All tests run under `node --test --import tsx` (the `test:unit` glob). Every
module in the arc is pure except the PR 19 kill-switch guard, whose live edit is
default-preserving.
