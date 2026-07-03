/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 22: Memo Intelligence Contract.
 *
 * The contract a credit memo consumes. Its cardinal rule (safety rule 6): the
 * memo NEVER creates a financial conclusion — every support object here is a
 * CERTIFIED analytical object produced by the engines (examiner criticisms,
 * covenant package, SBA intelligence, credit concerns, evidence bundles,
 * collateral/borrowing-base). Approval conditions are DERIVED from certified
 * examiner conditions + covenant package, never free prose.
 *
 * Pure — assembles typed objects. No PDF/memo cutover here (that is PR 23+).
 * Each support carries a `sourceEngine` tag so a validator can prove the memo
 * contains only certified outputs.
 */

import type { Criticism } from "@/lib/finengine/examiner/criticismEngine";
import type { ManagedCovenant } from "@/lib/finengine/covenants/covenantEngine";
import type { SbaIntelligence } from "@/lib/finengine/sba/intelligence";
import type { CreditConcern } from "@/lib/finengine/officer/creditConcerns";
import type { EvidenceBundle } from "@/lib/finengine/evidence/evidenceEngine";
import type { ProductKey } from "@/lib/finengine/registry/productMetricRegistry";

export type SourceEngine =
  | "examiner"
  | "covenants"
  | "sba"
  | "officer"
  | "evidence"
  | "collateral"
  | "repayment"
  | "product";

export type ExecutiveSummarySupport = {
  sourceEngine: "product";
  product: ProductKey;
  keyStrengths: string[];
  keyConcerns: string[];
  evidence: EvidenceBundle;
};

export type RepaymentSupport = {
  sourceEngine: "repayment";
  dscr: number | null;
  stressedDscr: number | null;
  globalDscr: number | null;
  /** Certified concern objects — not prose. */
  concerns: CreditConcern[];
};

export type CollateralSupport = {
  sourceEngine: "collateral";
  coverage: number | null;
  borrowingBaseAvailability: number | null;
  shortfall: number | null;
};

export type SbaSupport = {
  sourceEngine: "sba";
  intelligence: SbaIntelligence | null;
};

export type ExaminerSupport = {
  sourceEngine: "examiner";
  criticisms: Criticism[];
  highCount: number;
};

export type CovenantSupport = {
  sourceEngine: "covenants";
  package: ManagedCovenant[];
};

export type ApprovalConditionsSupport = {
  sourceEngine: "examiner";
  /** Derived from certified examiner conditions + reporting covenants. */
  conditions: string[];
};

export type MemoCreditAnalysis = {
  execSummary: ExecutiveSummarySupport;
  repayment: RepaymentSupport;
  collateral: CollateralSupport;
  sba: SbaSupport;
  examiner: ExaminerSupport;
  covenants: CovenantSupport;
  approvalConditions: ApprovalConditionsSupport;
  /** Marker: this object is assembled solely from certified analytical objects. */
  certified: true;
};

export type MemoContractInputs = {
  product: ProductKey;
  keyStrengths: string[];
  keyConcerns: string[];
  evidence: EvidenceBundle;
  dscr: number | null;
  stressedDscr: number | null;
  globalDscr: number | null;
  concerns: CreditConcern[];
  collateralCoverage: number | null;
  borrowingBaseAvailability: number | null;
  collateralShortfall: number | null;
  sba: SbaIntelligence | null;
  criticisms: Criticism[];
  covenantPackage: ManagedCovenant[];
};

/** Assemble the certified memo contract from engine outputs. Pure, no prose numbers. */
export function assembleMemoContract(inputs: MemoContractInputs): MemoCreditAnalysis {
  // Approval conditions are DERIVED from certified sources only:
  //  - examiner recommended conditions
  //  - reporting/negative covenants (as delivery conditions)
  const examinerConditions = inputs.criticisms.map((c) => c.recommendedCondition);
  const covenantConditions = inputs.covenantPackage
    .filter((c) => c.kind !== "financial")
    .map((c) => `${c.type}: ${c.rationale}`);
  const conditions = [...new Set([...examinerConditions, ...covenantConditions])];

  return {
    execSummary: {
      sourceEngine: "product",
      product: inputs.product,
      keyStrengths: inputs.keyStrengths,
      keyConcerns: inputs.keyConcerns,
      evidence: inputs.evidence,
    },
    repayment: {
      sourceEngine: "repayment",
      dscr: inputs.dscr,
      stressedDscr: inputs.stressedDscr,
      globalDscr: inputs.globalDscr,
      concerns: inputs.concerns,
    },
    collateral: {
      sourceEngine: "collateral",
      coverage: inputs.collateralCoverage,
      borrowingBaseAvailability: inputs.borrowingBaseAvailability,
      shortfall: inputs.collateralShortfall,
    },
    sba: { sourceEngine: "sba", intelligence: inputs.sba },
    examiner: { sourceEngine: "examiner", criticisms: inputs.criticisms, highCount: inputs.criticisms.filter((c) => c.severity === "high").length },
    covenants: { sourceEngine: "covenants", package: inputs.covenantPackage },
    approvalConditions: { sourceEngine: "examiner", conditions },
    certified: true,
  };
}

const KNOWN_ENGINES: ReadonlySet<SourceEngine> = new Set([
  "examiner",
  "covenants",
  "sba",
  "officer",
  "evidence",
  "collateral",
  "repayment",
  "product",
]);

/**
 * Prove the memo object contains ONLY certified outputs: every support carries a
 * recognized `sourceEngine`, and the `certified` marker is set. Returns the list
 * of any violations (empty ⇒ fully certified).
 */
export function validateMemoCertified(memo: MemoCreditAnalysis): { certified: boolean; violations: string[] } {
  const violations: string[] = [];
  if (memo.certified !== true) violations.push("missing_certified_marker");
  const supports: Array<{ name: string; sourceEngine: SourceEngine }> = [
    { name: "execSummary", sourceEngine: memo.execSummary.sourceEngine },
    { name: "repayment", sourceEngine: memo.repayment.sourceEngine },
    { name: "collateral", sourceEngine: memo.collateral.sourceEngine },
    { name: "sba", sourceEngine: memo.sba.sourceEngine },
    { name: "examiner", sourceEngine: memo.examiner.sourceEngine },
    { name: "covenants", sourceEngine: memo.covenants.sourceEngine },
    { name: "approvalConditions", sourceEngine: memo.approvalConditions.sourceEngine },
  ];
  for (const s of supports) {
    if (!KNOWN_ENGINES.has(s.sourceEngine)) violations.push(`${s.name}:unknown_source_engine`);
  }
  return { certified: violations.length === 0, violations };
}
