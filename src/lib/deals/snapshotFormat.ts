/**
 * Display formatting for DealFinancialSnapshotV1 ratio metrics.
 *
 * Snapshot percent-style metrics (ltv_gross, ltv_net, occupancy_pct,
 * vacancy_pct, borrower_equity_pct) are stored as 0–1 ratios: the canonical
 * facts they come from are written that way (LTV = loan / collateral,
 * equity % = equity / project cost, rent-roll occupancy as a decimal). The
 * deal header, committee panel and borrower portal formatted them as if they
 * were already 0–100, so an 80% LTV rendered as "1%" and 20% equity as "0%".
 *
 * Pure module — safe to import from client components and unit tests.
 */

export function ratioToPercentString(ratio: number | null | undefined, digits = 0): string {
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}
