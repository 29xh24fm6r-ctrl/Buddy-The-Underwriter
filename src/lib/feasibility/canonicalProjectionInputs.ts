import { defensiveInterval } from "@/lib/finengine/metrics/balanceSheet";

/**
 * Read decision inputs already computed by the canonical SBA projection
 * engine. Feasibility is a consumer of these values; it must never recreate
 * capitalization math with a second formula.
 */

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function ratio(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

/** Planned reserve coverage, not verified bank cash. Consume only the
 * reconciled package's working-capital allocation and first-year cash costs.
 * The existing financial engine owns the coverage division. */
export function readCanonicalReserveMonths(sourcesAndUses: unknown, projectionsAnnual: unknown): number | null {
  const budget = record(sourcesAndUses);
  const firstYear = Array.isArray(projectionsAnnual) ? record(projectionsAnnual[0]) : null;
  const valid = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (budget?.balanced !== true || !Array.isArray(budget.uses) || !firstYear ||
      !valid(firstYear.cogs) || !valid(firstYear.operatingExpenses)) return null;
  const reserves = budget.uses.map(record).filter(row => row?.category === "working_capital");
  if (!reserves.length || reserves.some(row => !valid(row?.amount))) return null;
  const reserve = reserves.reduce((total, row) => total + (row!.amount as number), 0);
  const annualCashCosts = firstYear.cogs + firstYear.operatingExpenses;
  if (!Number.isFinite(reserve) || !Number.isFinite(annualCashCosts) || annualCashCosts <= 0) return null;
  const days = defensiveInterval(reserve, 0, 0, annualCashCosts / 365).value;
  const months = days == null ? null : days * 12 / 365;
  return months != null && Number.isFinite(months) ? months : null;
}

export function readCanonicalEquityInjectionPct(
  sourcesAndUses: unknown,
): number | null {
  const payload = record(sourcesAndUses);
  if (!payload) return null;

  const canonicalEquity = record(payload.equityInjection);
  const canonicalPct = ratio(canonicalEquity?.actualPct);
  if (canonicalPct != null) return canonicalPct;

  // Read compatibility for packages produced before the canonical engine
  // nested its equity result. This is still a direct read, never a re-derive.
  return ratio(payload.equityInjectionPct);
}

/** Read all years from the saved scenario, including legacy field names.
 * Absent downside evidence must never fall back to the base case. */
export function readCanonicalDownsideCoverage(scenarios: unknown): [number | null, number | null, number | null] {
  const downside = Array.isArray(scenarios) ? scenarios.map(record).find(row =>
    [row?.name, row?.scenario].some(name => typeof name === "string" && name.trim().toLowerCase() === "downside")) : null;
  const finite = (value: unknown): number | null => {
    if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const year = (n: number) => finite(downside?.[`dscrYear${n}`] ?? downside?.[`dscr_year${n}`]);
  return [year(1), year(2), year(3)];
}
