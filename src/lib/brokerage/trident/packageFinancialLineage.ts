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
  const pairs = [
    [memo.metadata_json.financial_payload, { baseYear: expected.baseYear, annualProjections: expected.projectionModel.annualProjections, sourcesAndUses: expected.sourcesAndUses, balanceSheetProjections: expected.balanceSheetProjections, assumptions: expected.assumptions, globalCashFlow: expected.globalCashFlow }],
    [spread.rendered_json.financialRenderInputHash, deterministicHash(expected.spreadInput)],
    [pkg.projections_annual, expected.projectionModel.annualProjections],
    [pkg.projections_monthly, expected.projectionModel.monthlyProjections],
    [pkg.base_year_data, expected.baseYear],
    [pkg.sources_and_uses, expected.sourcesAndUses],
    [pkg.balance_sheet_projections, expected.balanceSheetProjections],
  ];
  if (pairs.some(([actual, saved]) => deterministicHash(actual) !== deterministicHash(saved))) {
    throw new Error("release blocked: stored artifact figures differ from the authoritative financial output");
  }
}
