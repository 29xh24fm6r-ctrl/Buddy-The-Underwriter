/**
 * SPEC-FINENGINE-BALANCE-SHEET-PANEL-1 §1 — the net-new metric allowlist + projector.
 *
 * The finengine balance-sheet panel renders ONLY the COMPLEMENT of what the legacy
 * financials board already shows — the balance-sheet / solvency / activity / distress
 * universe `computeDealSpread` computes but the legacy spread never produced. This is
 * the one-engine firewall: two engines never render the same number two ways.
 *
 * HARD EXCLUSIONS (on the legacy board or legacy headline numbers): EBITDA, DSCR,
 * CURRENT_RATIO, DEBT_TO_EQUITY, and every `*_MARGIN`. The allowlist ∩ legacy set = ∅
 * is asserted in a unit test.
 *
 * Metric names are the EXACT `cell.metric` strings `computeDealSpread` emits (verified
 * by running the engine): days metrics are `DSO`/`DIO`/`DPO`, returns are `ROA`/`ROE`,
 * working-capital-to-sales is `WC_TO_SALES`, debt-to-effective-TNW is `DEBT_TO_ETNW`.
 *
 * Pure — no DB, no server-only.
 */

import { SENTINEL_PERIOD, type EntityScope } from "@/lib/finengine/shadow/dealInputAdapter";
import type { DealSpread, MetricCell } from "@/lib/finengine/spread/dealSpread";

const SERIES_PERIOD = "SERIES";

/**
 * The net-new balance-sheet ratio universe, grouped for display. Every metric here
 * is emitted by `computeDealSpread` and is NOT shown on the legacy financials board.
 */
export const BALANCE_SHEET_PANEL_METRICS: Record<string, string[]> = {
  Liquidity: ["CASH_RATIO", "QUICK_RATIO", "NET_WORKING_CAPITAL", "WC_TO_SALES"],
  Leverage: ["DEBT_TO_WORTH", "DEBT_TO_ETNW", "LIABILITIES_TO_ASSETS", "DEBT_TO_CAPITAL", "EQUITY_RATIO", "EQUITY_MULTIPLIER"],
  Activity: ["DSO", "DIO", "DPO", "AR_TURNOVER", "INVENTORY_TURNOVER", "AP_TURNOVER", "ASSET_TURNOVER"],
  Adjustments: ["TANGIBLE_NET_WORTH", "EFFECTIVE_TANGIBLE_NET_WORTH", "FIXED_ASSET_AGE", "NET_TO_GROSS_PPE", "NET_WORTH_RECONCILIATION"],
  Distress: ["ALTMAN_Z_PRIME", "ALTMAN_Z_DOUBLE_PRIME"],
  Returns: ["ROA", "ROE"],
};

/** Flat allowlist — the server-side firewall set. */
export const PANEL_METRIC_SET: ReadonlySet<string> = new Set(Object.values(BALANCE_SHEET_PANEL_METRICS).flat());

/**
 * Metrics the LEGACY financials board displays (Panel A strip + buildRows) OR that the
 * §1 hard rule excludes — expressed as `computeDealSpread` cell.metric names. The panel
 * allowlist must be disjoint from this set (the one-engine wall, asserted in tests).
 */
export const LEGACY_DISPLAYED_METRICS: ReadonlySet<string> = new Set([
  "EBITDA", "EBITDA_MARGIN", "DSCR", "GROSS_MARGIN",
  "CURRENT_RATIO", "DEBT_TO_EQUITY", "LEVERAGE_TOTAL",
  // every P&L margin is a legacy/headline concept, never balance-sheet analysis
  "OPERATING_MARGIN", "NET_MARGIN", "PRETAX_MARGIN",
]);

/** Display labels (fallback derives a title-case label from the metric key). */
const LABELS: Record<string, string> = {
  CASH_RATIO: "Cash Ratio",
  QUICK_RATIO: "Quick Ratio (Acid Test)",
  NET_WORKING_CAPITAL: "Net Working Capital",
  WC_TO_SALES: "Working Capital to Sales",
  DEBT_TO_WORTH: "Debt to Worth",
  DEBT_TO_ETNW: "Debt to Effective TNW",
  LIABILITIES_TO_ASSETS: "Liabilities to Assets",
  DEBT_TO_CAPITAL: "Debt to Capital",
  EQUITY_RATIO: "Equity Ratio",
  EQUITY_MULTIPLIER: "Equity Multiplier",
  DSO: "Days Sales Outstanding",
  DIO: "Days Inventory On Hand",
  DPO: "Days Payable Outstanding",
  AR_TURNOVER: "AR Turnover",
  INVENTORY_TURNOVER: "Inventory Turnover",
  AP_TURNOVER: "AP Turnover",
  ASSET_TURNOVER: "Asset Turnover",
  TANGIBLE_NET_WORTH: "Tangible Net Worth",
  EFFECTIVE_TANGIBLE_NET_WORTH: "Effective Tangible Net Worth",
  FIXED_ASSET_AGE: "Fixed Asset Age",
  NET_TO_GROSS_PPE: "Net-to-Gross PP&E",
  NET_WORTH_RECONCILIATION: "Net Worth Reconciliation",
  ALTMAN_Z_PRIME: "Altman Z′",
  ALTMAN_Z_DOUBLE_PRIME: "Altman Z″",
  ROA: "Return on Assets",
  ROE: "Return on Equity",
};

function labelFor(metric: string): string {
  return LABELS[metric] ?? metric.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export type PanelCell = {
  metric: string;
  label: string;
  value: number;
  rating: string;
  interpretation: string;
  period: string;
};

export type PanelGroup = { family: string; cells: PanelCell[] };

export type FinengineSpreadProjection = { period: string | null; groups: PanelGroup[] };

/** Dark / disabled response — no payload (dark-by-default for un-flipped tenants). */
export type FinengineSpreadResponse = { enabled: false } | ({ enabled: true } & FinengineSpreadProjection);

const isReal = (period: string): boolean => period !== SENTINEL_PERIOD && period !== SERIES_PERIOD;

/**
 * Project a computed DealSpread down to the panel allowlist: for each allowlisted
 * metric, the cell at the latest REAL period for the given scope (default BUSINESS),
 * with its rating + interpretation. NEVER emits a metric outside the allowlist — the
 * projection iterates the allowlist, so a non-allowlist cell cannot leak through.
 */
export function projectBalanceSheetPanel(spread: DealSpread, scope: EntityScope = "BUSINESS"): FinengineSpreadProjection {
  const inScope = spread.cells.filter((c) => c.scope === scope && c.value != null && isReal(c.period));

  const latestForMetric = (metric: string): MetricCell | null => {
    const matches = inScope.filter((c) => c.metric === metric);
    if (matches.length === 0) return null;
    return matches.reduce((best, c) => (c.period > best.period ? c : best));
  };

  let latestPeriod: string | null = null;
  const groups: PanelGroup[] = [];
  for (const [family, metrics] of Object.entries(BALANCE_SHEET_PANEL_METRICS)) {
    const cells: PanelCell[] = [];
    for (const metric of metrics) {
      // Firewall: only allowlisted metrics are ever considered.
      if (!PANEL_METRIC_SET.has(metric)) continue;
      const cell = latestForMetric(metric);
      if (!cell || cell.value == null) continue;
      if (latestPeriod == null || cell.period > latestPeriod) latestPeriod = cell.period;
      cells.push({
        metric,
        label: labelFor(metric),
        value: cell.value,
        rating: cell.rating,
        interpretation: cell.interpretation.meaning,
        period: cell.period,
      });
    }
    if (cells.length > 0) groups.push({ family, cells });
  }

  return { period: latestPeriod, groups };
}

/**
 * Build the route's response from the resolved render source + the (optional) spread.
 * `legacy` ⇒ `{ enabled:false }` with NO payload — dark by default. `finengine` ⇒ the
 * allowlist-only projection. Pure; the route is a thin shell over this.
 */
export function buildFinengineSpreadResponse(source: "finengine" | "legacy", spread: DealSpread | null): FinengineSpreadResponse {
  if (source !== "finengine" || !spread) return { enabled: false };
  const { period, groups } = projectBalanceSheetPanel(spread);
  return { enabled: true, period, groups };
}
