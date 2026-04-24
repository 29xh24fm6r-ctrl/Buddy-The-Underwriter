import type { ScoreInputs } from "../inputs";
import type { ComponentScore, SubFactorScore } from "../types";
import {
  scoreCollateralCoverage,
  scoreEquityInjectionPct,
  scoreGuarantyCoverage,
  scoreLoanToProject,
} from "../scoringCurves";
import { finalizeComponent } from "./shared";

export function scoreDealStructure(inputs: ScoreInputs): ComponentScore {
  const equityPct =
    inputs.equityInjectionAmount != null && inputs.totalProjectCost && inputs.totalProjectCost > 0
      ? inputs.equityInjectionAmount / inputs.totalProjectCost
      : null;

  const loanToProject =
    inputs.loanAmount != null && inputs.totalProjectCost && inputs.totalProjectCost > 0
      ? inputs.loanAmount / inputs.totalProjectCost
      : null;

  const collateralCoverage =
    inputs.collateralNetLendableTotal != null &&
    inputs.loanAmount != null &&
    inputs.loanAmount > 0
      ? inputs.collateralNetLendableTotal / inputs.loanAmount
      : null;

  const subFactors: SubFactorScore[] = [
    {
      name: "equity_injection_pct",
      rawScore: scoreEquityInjectionPct(equityPct),
      weight: 0.4,
      value: equityPct,
      source: "buddy_sba_packages.sources_and_uses",
      narrative: equityPct != null
        ? `Equity injection ${(equityPct * 100).toFixed(1)}%`
        : "Equity injection percentage cannot be computed",
    },
    {
      name: "loan_to_project_ratio",
      rawScore: scoreLoanToProject(loanToProject),
      weight: 0.3,
      value: loanToProject,
      source: "deals.loan_amount + buddy_sba_packages.sources_and_uses.total_project_cost",
      narrative: loanToProject != null
        ? `Loan-to-project ratio ${(loanToProject * 100).toFixed(1)}%`
        : "Loan-to-project ratio cannot be computed",
    },
    {
      name: "collateral_coverage",
      rawScore: scoreCollateralCoverage(collateralCoverage),
      weight: 0.2,
      value: collateralCoverage,
      source: "deal_collateral_items.net_lendable_value / deals.loan_amount",
      narrative: collateralCoverage != null
        ? `Collateral coverage ${(collateralCoverage * 100).toFixed(1)}%`
        : "Collateral coverage not available",
    },
    {
      name: "sba_guaranty_coverage",
      rawScore: scoreGuarantyCoverage(inputs.sbaGuarantyPct),
      weight: 0.1,
      value: inputs.sbaGuarantyPct,
      source: "buddy_sba_packages.sba_guarantee_pct",
      narrative: inputs.sbaGuarantyPct != null
        ? `SBA guaranty ${(inputs.sbaGuarantyPct * 100).toFixed(1)}%`
        : "SBA guaranty percentage not set",
    },
  ];

  const narrative = buildStructureNarrative(subFactors);

  return finalizeComponent({
    componentName: "deal_structure",
    weight: inputs.isFranchise ? 0.15 : 0.17,
    subFactors,
    narrative,
  });
}

function buildStructureNarrative(subFactors: SubFactorScore[]): string {
  const pieces: string[] = [];
  const eq = subFactors.find((s) => s.name === "equity_injection_pct");
  if (eq?.rawScore != null && typeof eq.value === "number") {
    pieces.push(`equity ${(eq.value * 100).toFixed(0)}%`);
  }
  const ltp = subFactors.find((s) => s.name === "loan_to_project_ratio");
  if (ltp?.rawScore != null && typeof ltp.value === "number") {
    pieces.push(`LTP ${(ltp.value * 100).toFixed(0)}%`);
  }
  const col = subFactors.find((s) => s.name === "collateral_coverage");
  if (col?.rawScore != null && typeof col.value === "number") {
    pieces.push(`collateral ${(col.value * 100).toFixed(0)}%`);
  }
  return pieces.length > 0
    ? `Deal structure: ${pieces.join(", ")}.`
    : "Deal-structure inputs largely missing.";
}
