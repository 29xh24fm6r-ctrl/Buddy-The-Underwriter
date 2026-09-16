import type { CovenantPackage } from "@/lib/covenants/covenantTypes";
import type { RatioAnalysisRow } from "./types";

/** Refresh only untouched machine drafts; banker decisions remain reviewable. */
export function shouldRefreshCovenantDraft(
  pkg: CovenantPackage,
  status: string,
  governedFloor: number,
): boolean {
  if (status !== "draft" || pkg.customizations.length || pkg.bankerNotes.trim()) return false;
  const covenants = [...pkg.financial, ...pkg.reporting, ...pkg.affirmativeNegative, ...pkg.springing];
  if (covenants.some((c) => c.source !== "rule_engine")) return false;
  const dscr = pkg.financial.filter((c) => c.category === "dscr");
  return dscr.length !== 1 || dscr.some((c) => !Number.isFinite(c.threshold) || Math.abs(c.threshold - governedFloor) >= 0.005);
}

/** Do not publish a ratio from a separate fact selection when the memo lacks its basis. */
export function supportedMemoRatios(
  rows: RatioAnalysisRow[],
  netIncome: number | null,
  totalAssets: number | null,
): RatioAnalysisRow[] {
  const hasBasis = netIncome !== null && Number.isFinite(netIncome)
    && totalAssets !== null && Number.isFinite(totalAssets) && totalAssets > 0;
  return rows.filter((row) => !/return on assets|\broa\b/i.test(row.metric) || hasBasis);
}
