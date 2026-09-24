import test from "node:test";
import assert from "node:assert/strict";
import { assertPackageFinancialLineage } from "../packageFinancialLineage";
import { packageMemoFinancialPayload } from "@/lib/modelEngine/packageMemoFinancialPayload";
import { deterministicHash } from "@/lib/modelEngine/hashing";
import { classifyFactoryFailure } from "../factoryFailure";

function fixture(): Parameters<typeof assertPackageFinancialLineage>[0] {
  const annual = [{ revenue: 2753880, ebitda: 441496, totalDebtService: 257633.7, dscr: 441496 / 257633.7 }];
  const monthly = [{ revenue: 210000 }];
  const base = { revenue: 2000000 };
  const uses = { totalSources: 1000000, totalUses: 1000000 };
  const balance = [{ totalAssets: 1700000 }];
  const output = { spreadInput: {}, projectionModel: { annualProjections: annual, monthlyProjections: monthly,
    sensitivityScenarios: [{name:"downside",dscrYear1:1.44,dscrYear2:0.77,dscrYear3:0.14,passesSBAThreshold:false}] },
    baseYear: base, sourcesAndUses: uses, balanceSheetProjections: balance,
    assumptions: {status:"confirmed"}, globalCashFlow: {globalDSCR:null,evidenceStatus:"needs_information"} } as any;
  return {
    snapshot: { id: "financial-1", output } as any,
    packageId: "package-1", pkg: { financial_snapshot_id: "financial-1", projections_annual: structuredClone(annual), projections_monthly: monthly, sensitivity_scenarios: structuredClone(output.projectionModel.sensitivityScenarios), base_year_data: base, sources_and_uses: uses, balance_sheet_projections: balance },
    feasibility: { projections_package_id: "package-1" }, memo: { metadata_json: { financial_snapshot_id: "financial-1", financial_payload: structuredClone(packageMemoFinancialPayload(output)) } }, spread: { rendered_json: { financialSnapshotId: "financial-1", financialRenderInputHash: deterministicHash({}) } },
  };
}
test("one saved numeric version passes the complete package lineage check", () => assert.doesNotThrow(() => assertPackageFinancialLineage(fixture())));
test("a matching ID cannot conceal changed financial values", () => {
  const input = fixture(); input.pkg.projections_annual[0].ebitda += 80000;
  assert.throws(() => assertPackageFinancialLineage(input), /figures differ/);
});
test("business-plan sensitivity results cannot diverge from the frozen model", () => {
  const input = fixture(); input.pkg.sensitivity_scenarios[0].dscrYear3 = 9.99;
  assert.throws(() => assertPackageFinancialLineage(input), /package\.sensitivity_scenarios/);
});
test("feasibility attached to another projection version blocks release", () => {
  const input = fixture(); input.feasibility.projections_package_id = "old-package";
  assert.throws(() => assertPackageFinancialLineage(input), /different financial versions/);
});
test("budget and billing failures never retry immediately; timeouts may retry", () => {
  for (const error of ["daily token budget exceeded", "budget_unavailable", "insufficient_quota", "credit_balance_exhausted", "input_snapshot_changed", "financial_input_required"]) {
    assert.equal(classifyFactoryFailure(new Error(error)).retryable, false, error);
  }
  assert.equal(classifyFactoryFailure(new Error("upstream timed out")).retryable, true);
});

test("all three memo downside years and coverage verdict are part of release integrity", () => {
  for (const key of ["dscrYear1", "dscrYear2", "dscrYear3", "passesSBAThreshold"]) {
    const input = fixture();
    input.memo.metadata_json.financial_payload.sensitivityScenarios[0][key] = key === "passesSBAThreshold" ? true : 99;
    assert.throws(() => assertPackageFinancialLineage(input), /memo\.financial_payload/);
  }
  const input = fixture();
  delete input.memo.metadata_json.financial_payload.sensitivityScenarios;
  assert.throws(() => assertPackageFinancialLineage(input), /memo\.financial_payload/);
});
test("lineage reports every mismatched artifact without exposing financial values", () => {
  const input = fixture();
  input.memo.metadata_json.financial_payload.globalCashFlow.globalDSCR = 99;
  input.spread.rendered_json.financialRenderInputHash = "changed";
  input.pkg.projections_annual[0].revenue = 12345678;
  assert.throws(() => assertPackageFinancialLineage(input), (error: Error) => {
    assert.match(error.message, /memo\.financial_payload/);
    assert.match(error.message, /spread\.financialRenderInputHash/);
    assert.match(error.message, /package\.projections_annual/);
    assert.doesNotMatch(error.message, /12345678/);
    return true;
  });
});
