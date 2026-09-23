import type { AnnualProjectionYear } from "./sbaReadinessTypes";

/** A zero denominator is unavailable coverage, not a 99x borrower result. */
export function displayProjectionDscr(year: Pick<AnnualProjectionYear, "label" | "totalDebtService" | "dscr">): string {
  return year.label === "Pre-opening" || !(year.totalDebtService > 0) || !Number.isFinite(year.dscr)
    ? "N/A" : `${year.dscr.toFixed(2)}x`;
}
