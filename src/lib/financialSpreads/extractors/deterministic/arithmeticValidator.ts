/**
 * Arithmetic Validation Layer
 *
 * Runs after deterministic extraction. Validates computed relationships
 * between extracted facts. Writes TAX_RETURN_VALIDATION facts when
 * discrepancies are detected. This is how confidence scores reflect
 * reality rather than just "a pattern matched."
 */

export type ValidationResult = {
  rule: string;
  expected: number | null;
  actual: number | null;
  variance: number | null;
  variancePct: number | null;
  passes: boolean;
  message: string;
};

export type ArithmeticValidationReport = {
  validationCount: number;
  passCount: number;
  failCount: number;
  results: ValidationResult[];
  overallConfidence: number; // 0-1 based on pass rate
};

/**
 * Validate arithmetic relationships in extracted facts.
 * facts: Record<string, number | null> — the canonical key/value pairs
 */
export function validateArithmetic(
  facts: Record<string, number | null>,
): ArithmeticValidationReport {
  const results: ValidationResult[] = [];

  const get = (key: string): number | null => facts[key] ?? null;

  // Rule 1: Gross Profit = Gross Receipts - COGS
  const grossReceipts = get("GROSS_RECEIPTS");
  const cogs = get("COST_OF_GOODS_SOLD");
  const grossProfit = get("GROSS_PROFIT");
  if (grossReceipts !== null && cogs !== null && grossProfit !== null) {
    const expected = grossReceipts - cogs;
    const variance = Math.abs(grossProfit - expected);
    const variancePct = grossReceipts !== 0 ? variance / Math.abs(grossReceipts) : null;
    const passes = variancePct !== null && variancePct < 0.02; // 2% tolerance for rounding
    results.push({
      rule: "GROSS_PROFIT_CHECK",
      expected,
      actual: grossProfit,
      variance,
      variancePct,
      passes,
      message: passes
        ? "Gross Profit reconciles with Gross Receipts - COGS"
        : `Gross Profit discrepancy: expected ${fmtCurrency(expected)}, got ${fmtCurrency(grossProfit)} (${fmtPct(variancePct)} variance)`,
    });
  }

  // Rule 2: Schedule L — Total Assets = Total Liabilities + Total Equity
  const totalAssets = get("SL_TOTAL_ASSETS");
  const totalLiabilities = get("SL_TOTAL_LIABILITIES");
  const totalEquity = get("SL_TOTAL_EQUITY");
  if (totalAssets !== null && totalLiabilities !== null && totalEquity !== null) {
    const expected = totalLiabilities + totalEquity;
    const variance = Math.abs(totalAssets - expected);
    const variancePct = totalAssets !== 0 ? variance / Math.abs(totalAssets) : null;
    const passes = variancePct !== null && variancePct < 0.03; // 3% tolerance
    results.push({
      rule: "BALANCE_SHEET_CHECK",
      expected,
      actual: totalAssets,
      variance,
      variancePct,
      passes,
      message: passes
        ? "Schedule L balances: Total Assets = Liabilities + Equity"
        : `Schedule L IMBALANCE: Assets ${fmtCurrency(totalAssets)} != Liabilities + Equity ${fmtCurrency(expected)} — tax return balance sheet does not balance`,
    });
  }

  // Rule 3: M-1 reconciliation — Taxable Income should approximately reconcile
  const m1BookIncome = get("M1_BOOK_INCOME");
  const m1TaxableIncome = get("M1_TAXABLE_INCOME");
  const m1TotalAdditions = get("M1_TOTAL_ADDITIONS");
  if (m1BookIncome !== null && m1TaxableIncome !== null && m1TotalAdditions !== null) {
    const gap = Math.abs(m1TaxableIncome - m1BookIncome);
    const gapPct = m1BookIncome !== 0 ? gap / Math.abs(m1BookIncome) : null;
    const passes = gapPct !== null && gapPct < 0.50; // flag if >50% unexplained gap
    results.push({
      rule: "M1_RECONCILIATION_CHECK",
      expected: m1BookIncome,
      actual: m1TaxableIncome,
      variance: gap,
      variancePct: gapPct,
      passes,
      message: passes
        ? "M-1 book/tax difference within expected range"
        : `M-1 large gap: Book income ${fmtCurrency(m1BookIncome)} vs taxable income ${fmtCurrency(m1TaxableIncome)} — ${fmtPct(gapPct)} difference requires explanation`,
    });
  }

  // Rule 4: K-1 ordinary income should be positive if business is profitable
  const k1OrdinaryIncome = get("K1_ORDINARY_INCOME");
  const netIncome = get("NET_INCOME") ?? get("ORDINARY_BUSINESS_INCOME");
  if (k1OrdinaryIncome !== null && netIncome !== null) {
    const signsMatch = (k1OrdinaryIncome >= 0) === (netIncome >= 0);
    results.push({
      rule: "K1_INCOME_SIGN_CHECK",
      expected: netIncome,
      actual: k1OrdinaryIncome,
      variance: Math.abs(k1OrdinaryIncome - netIncome),
      variancePct: netIncome !== 0 ? Math.abs(k1OrdinaryIncome - netIncome) / Math.abs(netIncome) : null,
      passes: signsMatch,
      message: signsMatch
        ? "K-1 ordinary income sign consistent with entity net income"
        : `K-1 sign mismatch: K-1 shows ${fmtCurrency(k1OrdinaryIncome)} but entity net income is ${fmtCurrency(netIncome)}`,
    });
  }

  const passCount = results.filter((r) => r.passes).length;
  const failCount = results.filter((r) => !r.passes).length;
  const overallConfidence = results.length > 0 ? passCount / results.length : 0.5;

  return {
    validationCount: results.length,
    passCount,
    failCount,
    results,
    overallConfidence,
  };
}

function fmtCurrency(n: number | null): string {
  if (n === null) return "N/A";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function fmtPct(n: number | null): string {
  if (n === null) return "N/A";
  return `${(n * 100).toFixed(1)}%`;
}
