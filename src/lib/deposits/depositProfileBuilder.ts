/**
 * Deposit profile builder — analyzes monthly bank balance data
 * for underwriting signals and relationship value.
 * Pure function — no DB.
 */

export type DepositProfile = {
  averageDailyBalance: number | null;
  balanceVolatility: number | null; // standard deviation
  lowestMonthlyBalance: number | null;
  highestMonthlyBalance: number | null;
  lowBalancePeriods: Array<{
    month: string;
    balance: number;
    flag: string;
  }>;
  seasonalPattern:
    | "CONSISTENT"
    | "SEASONAL"
    | "VOLATILE"
    | "INSUFFICIENT_DATA";
  depositRelationshipValue: number | null; // averageDailyBalance * 0.003 (ECR estimate)
  creditSignals: string[]; // flags for underwriting
};

export function buildDepositProfile(
  monthlyBalances: Array<{ month: string; avgBalance: number | null }>
): DepositProfile {
  const nonNull = monthlyBalances.filter(
    (m): m is { month: string; avgBalance: number } => m.avgBalance !== null
  );

  if (nonNull.length === 0) {
    return {
      averageDailyBalance: null,
      balanceVolatility: null,
      lowestMonthlyBalance: null,
      highestMonthlyBalance: null,
      lowBalancePeriods: [],
      seasonalPattern: "INSUFFICIENT_DATA",
      depositRelationshipValue: null,
      creditSignals: [],
    };
  }

  const values = nonNull.map((m) => m.avgBalance);
  const sum = values.reduce((a, b) => a + b, 0);
  const averageDailyBalance = sum / values.length;

  // Standard deviation
  const variance =
    values.reduce((acc, v) => acc + (v - averageDailyBalance) ** 2, 0) /
    values.length;
  const balanceVolatility = Math.sqrt(variance);

  const lowestMonthlyBalance = Math.min(...values);
  const highestMonthlyBalance = Math.max(...values);

  // Low balance periods: months where avgBalance < average * 0.50
  const lowThreshold = averageDailyBalance * 0.5;
  const lowBalancePeriods = nonNull
    .filter((m) => m.avgBalance < lowThreshold)
    .map((m) => ({
      month: m.month,
      balance: m.avgBalance,
      flag: "Balance below 50% of average — possible cash flow stress",
    }));

  // Seasonal pattern
  let seasonalPattern: DepositProfile["seasonalPattern"];
  if (nonNull.length < 6) {
    seasonalPattern = "INSUFFICIENT_DATA";
  } else {
    const maxMinRatio =
      lowestMonthlyBalance > 0
        ? highestMonthlyBalance / lowestMonthlyBalance
        : Infinity;

    if (maxMinRatio > 2.5 && hasSeasonalClustering(nonNull)) {
      seasonalPattern = "SEASONAL";
    } else if (balanceVolatility > averageDailyBalance * 0.4) {
      seasonalPattern = "VOLATILE";
    } else {
      seasonalPattern = "CONSISTENT";
    }
  }

  const depositRelationshipValue = averageDailyBalance * 0.003;

  // Credit signals
  const creditSignals: string[] = [];

  if (lowBalancePeriods.length > 0) {
    creditSignals.push(
      `${lowBalancePeriods.length} month(s) with balance below 50% of average — cash flow stress indicator`
    );
  }

  if (seasonalPattern === "VOLATILE") {
    creditSignals.push(
      "Deposit balance volatility exceeds 40% of average — inconsistent cash flow"
    );
  }

  // Check for negative or null balances after the first month
  for (let i = 1; i < monthlyBalances.length; i++) {
    const m = monthlyBalances[i];
    if (m.avgBalance === null) {
      creditSignals.push(
        `Missing balance data for ${m.month} — potential account dormancy`
      );
    } else if (m.avgBalance < 0) {
      creditSignals.push(
        `Negative balance in ${m.month} ($${m.avgBalance.toLocaleString()}) — overdraft activity`
      );
    }
  }

  return {
    averageDailyBalance,
    balanceVolatility,
    lowestMonthlyBalance,
    highestMonthlyBalance,
    lowBalancePeriods,
    seasonalPattern,
    depositRelationshipValue,
    creditSignals,
  };
}

/**
 * Check if low-balance months cluster in the same calendar period.
 * Simple heuristic: if the low months (below median) span <= 5 consecutive months.
 */
function hasSeasonalClustering(
  months: Array<{ month: string; avgBalance: number }>
): boolean {
  if (months.length < 6) return false;

  const sorted = [...months].sort((a, b) => a.avgBalance - b.avgBalance);
  const median = sorted[Math.floor(sorted.length / 2)].avgBalance;

  const lowMonthIndices = months
    .map((m, i) => (m.avgBalance < median ? i : -1))
    .filter((i) => i >= 0);

  if (lowMonthIndices.length < 2) return false;

  const span =
    lowMonthIndices[lowMonthIndices.length - 1] - lowMonthIndices[0] + 1;
  return span <= Math.ceil(months.length / 2);
}
