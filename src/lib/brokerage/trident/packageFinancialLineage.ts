import { packageMemoFinancialPayload } from "@/lib/modelEngine/packageMemoFinancialPayload";
import { deterministicHash } from "@/lib/modelEngine/hashing";
import type { PackageFinancialSnapshot } from "@/lib/modelEngine/packageFinancialSnapshot";

/** Publication validates persisted numeric payloads, not only foreign-key labels. */
export function assertPackageFinancialLineage(args: {
  snapshot: PackageFinancialSnapshot; packageId: string;
  pkg: any; feasibility: any; memo: any; spread: any;
}) {
  const { snapshot, pkg, feasibility, memo, spread } = args;
  if (pkg?.financial_snapshot_id !== snapshot.id ||
      memo?.metadata_json?.financial_snapshot_id !== snapshot.id ||
      spread?.rendered_json?.financialSnapshotId !== snapshot.id ||
      feasibility?.projections_package_id !== args.packageId) {
    throw new Error("release blocked: package documents reference different financial versions");
  }
  const expected = snapshot.output;
  const pairs: Array<[string, unknown, unknown]> = [
    ["memo.financial_payload", memo.metadata_json.financial_payload, packageMemoFinancialPayload(expected)],
    ["spread.financialRenderInputHash", spread.rendered_json.financialRenderInputHash, deterministicHash(expected.spreadInput)],
    ["package.projections_annual", pkg.projections_annual, expected.projectionModel.annualProjections],
    ["package.projections_monthly", pkg.projections_monthly, expected.projectionModel.monthlyProjections],
    ["package.sensitivity_scenarios", pkg.sensitivity_scenarios, expected.projectionModel.sensitivityScenarios],
    ["package.base_year_data", pkg.base_year_data, expected.baseYear],
    ["package.sources_and_uses", pkg.sources_and_uses, expected.sourcesAndUses],
    ["package.balance_sheet_projections", pkg.balance_sheet_projections, expected.balanceSheetProjections],
  ];
  const mismatches = pairs.filter(([, actual, saved]) => deterministicHash(actual) !== deterministicHash(saved)).map(([field]) => field);
  if (mismatches.length) {
    // Field names only: financial values and borrower information stay out of errors.
    throw new Error(`release blocked: stored artifact figures differ from the authoritative financial output (${mismatches.join(", ")})`);
  }
}
