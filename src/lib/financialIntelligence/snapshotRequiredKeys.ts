/**
 * Snapshot Required Keys — Deal-Type-Aware
 *
 * SPEC-SNAPSHOT-DEAL-TYPE-AWARE-1
 *
 * CRE metrics are never required for CONVENTIONAL or SBA deals.
 * TTM-only metrics (from T12 spread) are excluded for deals where
 * T12 is ineligible (SPEC-T12-GATE-1 companion).
 */

export const CRE_ONLY_KEYS = new Set([
  "in_place_rent_mo",
  "occupancy_pct",
  "vacancy_pct",
  "walt_years",
  "total_project_cost",
  "borrower_equity",
  "borrower_equity_pct",
  "ltv_gross",
  "ltv_net",
  "collateral_gross_value",
  "collateral_net_value",
  "collateral_discounted_value",
  "collateral_coverage",
]);

export const TTM_ONLY_KEYS = new Set([
  "total_income_ttm",
  "noi_ttm",
  "opex_ttm",
]);

const CONVENTIONAL_SBA_TYPES = new Set([
  "CONVENTIONAL", "SBA", "SBA_7A", "SBA_504", "SBA_EXPRESS",
]);

export function filterRequiredKeysForDealType(
  allKeys: readonly string[],
  dealType: string | null,
): string[] {
  const dt = (dealType ?? "CONVENTIONAL").toUpperCase();

  if (CONVENTIONAL_SBA_TYPES.has(dt)) {
    return allKeys.filter(
      (k) => !CRE_ONLY_KEYS.has(k) && !TTM_ONLY_KEYS.has(k),
    );
  }
  return [...allKeys];
}
