import type { PackageFinancialOutput } from "./packageFinancialComputation";

/** The exact financial payload persisted with a package memo and checked at release.
 * Keep writer and release validation on this contract as the model evolves. */
export function packageMemoFinancialPayload(output: PackageFinancialOutput) {
  return {
    baseYear: output.baseYear,
    annualProjections: output.projectionModel.annualProjections,
    sensitivityScenarios: output.projectionModel.sensitivityScenarios,
    sourcesAndUses: output.sourcesAndUses,
    balanceSheetProjections: output.balanceSheetProjections,
    assumptions: output.assumptions,
    globalCashFlow: output.globalCashFlow,
  };
}
