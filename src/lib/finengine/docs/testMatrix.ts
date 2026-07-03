/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 27: Documentation & Operator Evidence.
 *
 * Machine-checkable test matrix: maps each PR of the build arc to the module(s)
 * it added and the test file that guards it. A unit test asserts every listed
 * test file exists on disk — so "docs match code" is enforced, not just asserted.
 *
 * Pure data + a filesystem validator (used by the doc-consistency test).
 */

export type ArcEntry = {
  pr: number;
  title: string;
  /** Test file path (repo-relative). */
  testFile: string;
};

export const FINENGINE_ARC: ArcEntry[] = [
  { pr: 1, title: "Registry Consolidation Foundation", testFile: "src/lib/finengine/__tests__/registryConsolidation.test.ts" },
  { pr: 2, title: "Standard Spread Shadow Adapter", testFile: "src/lib/finengine/__tests__/standardShadowAdapter.test.ts" },
  { pr: 3, title: "Financial Statement Quality Engine", testFile: "src/lib/finengine/__tests__/statementQuality.test.ts" },
  { pr: 4, title: "Earnings Quality Engine", testFile: "src/lib/finengine/__tests__/earningsQuality.test.ts" },
  { pr: 5, title: "Cash Conversion Engine", testFile: "src/lib/finengine/__tests__/cashConversion.test.ts" },
  { pr: 6, title: "Industry Intelligence Engine", testFile: "src/lib/finengine/__tests__/industryIntelligenceEngine.test.ts" },
  { pr: 7, title: "Product Intelligence Framework", testFile: "src/lib/finengine/__tests__/productFramework.test.ts" },
  { pr: 8, title: "AR/ABL Borrowing Base Engine", testFile: "src/lib/finengine/__tests__/borrowingBase.test.ts" },
  { pr: 9, title: "CRE Property Intelligence Engine", testFile: "src/lib/finengine/__tests__/crePropertyIntelligence.test.ts" },
  { pr: 10, title: "Construction Loan Intelligence Engine", testFile: "src/lib/finengine/__tests__/constructionIntelligence.test.ts" },
  { pr: 11, title: "SBA 7(a)/504 Intelligence Engine", testFile: "src/lib/finengine/__tests__/sbaIntelligence.test.ts" },
  { pr: 12, title: "Examiner Criticism Engine", testFile: "src/lib/finengine/__tests__/examinerCriticism.test.ts" },
  { pr: 13, title: "Relationship / Entity Graph Intelligence", testFile: "src/lib/finengine/__tests__/entityGraphIntelligence.test.ts" },
  { pr: 14, title: "Evidence Engine", testFile: "src/lib/finengine/__tests__/evidenceEngine.test.ts" },
  { pr: 15, title: "Credit Officer Brain", testFile: "src/lib/finengine/__tests__/creditOfficerBrain.test.ts" },
  { pr: 16, title: "Covenant Recommendation & Monitoring Engine", testFile: "src/lib/finengine/__tests__/covenantEngine.test.ts" },
  { pr: 17, title: "Portfolio Intelligence Layer", testFile: "src/lib/finengine/__tests__/portfolioIntelligence.test.ts" },
  { pr: 18, title: "Shadow Reconciliation Matrix Expansion", testFile: "src/lib/finengine/__tests__/metricReconciliationMatrix.test.ts" },
  { pr: 19, title: "GCF Circular Writer Kill Switch", testFile: "src/lib/finengine/__tests__/gcfCircularWriterGuard.test.ts" },
  { pr: 20, title: "Legacy Producer Consumer Migration Plan", testFile: "src/lib/finengine/__tests__/legacyProducerAdapters.test.ts" },
  { pr: 21, title: "Product-by-Product Cutover Flags", testFile: "src/lib/finengine/__tests__/productCutoverFlags.test.ts" },
  { pr: 22, title: "Memo Intelligence Contract", testFile: "src/lib/finengine/__tests__/memoIntelligenceContract.test.ts" },
  { pr: 23, title: "Classic Spread / Memo Shadow Adapter", testFile: "src/lib/finengine/__tests__/classicMemoShadowAdapter.test.ts" },
  { pr: 24, title: "Finengine Certification Writer", testFile: "src/lib/finengine/__tests__/certificationWriter.test.ts" },
  { pr: 25, title: "First Safe Product Cutover Candidate", testFile: "src/lib/finengine/__tests__/ciTermDscrCutover.test.ts" },
  { pr: 26, title: "Legacy Burn-Down Ledger", testFile: "src/lib/finengine/__tests__/legacyBurndownLedger.test.ts" },
];

export type MatrixValidation = { ok: boolean; missing: string[] };

/**
 * Validate that every test file in the matrix exists. `fileExists` is injected so
 * this stays pure/testable (the doc-consistency test passes a real fs check).
 */
export function validateTestMatrix(fileExists: (path: string) => boolean): MatrixValidation {
  const missing = FINENGINE_ARC.filter((e) => !fileExists(e.testFile)).map((e) => e.testFile);
  return { ok: missing.length === 0, missing };
}
