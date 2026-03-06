/**
 * 3-Year Trend Analysis Engine — God Tier Spec Section 5G
 *
 * Pure-function engine computing 8 trend metrics with directional
 * assessment and risk signal detection.
 * No DB, no server imports, fully deterministic.
 *
 * Requires 2+ periods for directional assessment; 1 period = all null.
 * Direction determined by year-over-year changes across available periods.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TrendDirection =
  | "POSITIVE"
  | "NEUTRAL"
  | "DECLINING";

export type MarginDirection =
  | "EXPANDING"
  | "STABLE"
  | "COMPRESSING";

export type EfficiencyDirection =
  | "IMPROVING"
  | "STABLE"
  | "DETERIORATING";

export type LeverageDirection =
  | "IMPROVING"
  | "STABLE"
  | "WORSENING";

export type NetWorthDirection =
  | "GROWING"
  | "STABLE"
  | "ERODING";

export type TrendMetric<D extends string> = {
  direction: D | null;
  values: (number | null)[];
  riskSignal: string | null;
};

export type TrendAnalysisResult = {
  trendRevenue: TrendMetric<TrendDirection>;
  trendEbitda: TrendMetric<TrendDirection>;
  trendGrossMargin: TrendMetric<MarginDirection>;
  trendDso: TrendMetric<EfficiencyDirection>;
  trendDio: TrendMetric<EfficiencyDirection>;
  trendLeverage: TrendMetric<LeverageDirection>;
  trendDscr: TrendMetric<TrendDirection>;
  trendNetWorth: TrendMetric<NetWorthDirection>;
};

/**
 * Input for one period (year). Periods should be ordered oldest→newest.
 */
export type TrendPeriodInput = {
  year: number;
  revenue: number | null;
  ebitda: number | null;
  grossMarginPct: number | null;
  dso: number | null;
  dio: number | null;
  debtToEbitda: number | null;
  dscr: number | null;
  netWorth: number | null;
};

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export function analyzeTrends(
  periods: TrendPeriodInput[],
): TrendAnalysisResult {
  // Sort oldest → newest
  const sorted = [...periods].sort((a, b) => a.year - b.year);

  return {
    trendRevenue: analyzeHigherIsBetter(sorted, "revenue"),
    trendEbitda: analyzeHigherIsBetter(sorted, "ebitda"),
    trendGrossMargin: analyzeMargin(sorted),
    trendDso: analyzeEfficiency(sorted, "dso"),
    trendDio: analyzeEfficiency(sorted, "dio"),
    trendLeverage: analyzeLeverage(sorted),
    trendDscr: analyzeHigherIsBetter(sorted, "dscr"),
    trendNetWorth: analyzeNetWorth(sorted),
  };
}

// ---------------------------------------------------------------------------
// Higher-is-better metrics (Revenue, EBITDA, DSCR)
// ---------------------------------------------------------------------------

function analyzeHigherIsBetter(
  periods: TrendPeriodInput[],
  field: "revenue" | "ebitda" | "dscr",
): TrendMetric<TrendDirection> {
  const values = periods.map((p) => p[field]);
  const changes = computeChanges(values);

  if (changes.length === 0) {
    return { direction: null, values, riskSignal: null };
  }

  const direction = classifyHigherIsBetter(changes);

  let riskSignal: string | null = null;
  if (field === "revenue" && direction === "DECLINING" && changes.length >= 2) {
    riskSignal = "Declining revenue 2+ consecutive years — material risk";
  }

  return { direction, values, riskSignal };
}

function classifyHigherIsBetter(changes: number[]): TrendDirection {
  const allPositive = changes.every((c) => c > 0);
  const allNegative = changes.every((c) => c < 0);

  if (allPositive) return "POSITIVE";
  if (allNegative) return "DECLINING";
  return "NEUTRAL";
}

// ---------------------------------------------------------------------------
// Gross Margin trend — Expanding / Stable / Compressing
// ---------------------------------------------------------------------------

function analyzeMargin(
  periods: TrendPeriodInput[],
): TrendMetric<MarginDirection> {
  const values = periods.map((p) => p.grossMarginPct);
  const changes = computeChanges(values);

  if (changes.length === 0) {
    return { direction: null, values, riskSignal: null };
  }

  const allPositive = changes.every((c) => c > 0);
  const allNegative = changes.every((c) => c < 0);
  const allStable = changes.every((c) => Math.abs(c) < 1); // <1pp = stable

  let direction: MarginDirection;
  if (allStable) direction = "STABLE";
  else if (allPositive) direction = "EXPANDING";
  else if (allNegative) direction = "COMPRESSING";
  else direction = "STABLE";

  const riskSignal =
    direction === "COMPRESSING"
      ? "Margin compression — input cost or pricing pressure"
      : null;

  return { direction, values, riskSignal };
}

// ---------------------------------------------------------------------------
// Efficiency metrics (DSO, DIO) — lower is better
// ---------------------------------------------------------------------------

function analyzeEfficiency(
  periods: TrendPeriodInput[],
  field: "dso" | "dio",
): TrendMetric<EfficiencyDirection> {
  const values = periods.map((p) => p[field]);
  const changes = computeChanges(values);

  if (changes.length === 0) {
    return { direction: null, values, riskSignal: null };
  }

  // For DSO/DIO, DECREASING = IMPROVING (lower is better)
  const allDecreasing = changes.every((c) => c < 0);
  const allIncreasing = changes.every((c) => c > 0);

  let direction: EfficiencyDirection;
  if (allDecreasing) direction = "IMPROVING";
  else if (allIncreasing) direction = "DETERIORATING";
  else direction = "STABLE";

  let riskSignal: string | null = null;
  if (field === "dso" && direction === "DETERIORATING") {
    riskSignal = "Rising DSO — collection problems emerging";
  }
  if (field === "dio" && direction === "DETERIORATING") {
    riskSignal = "Rising DIO — inventory buildup or demand softening";
  }

  return { direction, values, riskSignal };
}

// ---------------------------------------------------------------------------
// Leverage trend (Debt/EBITDA) — lower is better
// ---------------------------------------------------------------------------

function analyzeLeverage(
  periods: TrendPeriodInput[],
): TrendMetric<LeverageDirection> {
  const values = periods.map((p) => p.debtToEbitda);
  const changes = computeChanges(values);

  if (changes.length === 0) {
    return { direction: null, values, riskSignal: null };
  }

  // DECREASING leverage = IMPROVING
  const allDecreasing = changes.every((c) => c < 0);
  const allIncreasing = changes.every((c) => c > 0);

  let direction: LeverageDirection;
  if (allDecreasing) direction = "IMPROVING";
  else if (allIncreasing) direction = "WORSENING";
  else direction = "STABLE";

  const riskSignal =
    direction === "WORSENING"
      ? "Worsening leverage — balance sheet deterioration"
      : null;

  return { direction, values, riskSignal };
}

// ---------------------------------------------------------------------------
// Net Worth trend — Growing / Stable / Eroding
// ---------------------------------------------------------------------------

function analyzeNetWorth(
  periods: TrendPeriodInput[],
): TrendMetric<NetWorthDirection> {
  const values = periods.map((p) => p.netWorth);
  const changes = computeChanges(values);

  if (changes.length === 0) {
    return { direction: null, values, riskSignal: null };
  }

  const allPositive = changes.every((c) => c > 0);
  const allNegative = changes.every((c) => c < 0);

  let direction: NetWorthDirection;
  if (allPositive) direction = "GROWING";
  else if (allNegative) direction = "ERODING";
  else direction = "STABLE";

  const riskSignal =
    direction === "ERODING"
      ? "Consistent net worth erosion — fundamental issue"
      : null;

  return { direction, values, riskSignal };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute year-over-year changes from an array of values.
 * Skips pairs where either value is null.
 * Returns empty array if fewer than 2 non-null consecutive values.
 */
function computeChanges(values: (number | null)[]): number[] {
  const changes: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const curr = values[i];
    if (prev !== null && curr !== null) {
      changes.push(curr - prev);
    }
  }
  return changes;
}
