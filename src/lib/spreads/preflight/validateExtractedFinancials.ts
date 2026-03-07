/**
 * E2 — Extraction Quality Validators
 *
 * Pure functions — no server-only, no DB, safe for CI guard imports.
 *
 * These validators check STRUCTURAL PLAUSIBILITY only.
 * They never express financial opinions or attempt to balance tax math.
 *
 * Rules:
 *   - Insufficient data → PASSED (don't block on missing data)
 *   - Structural anomaly → SUSPECT (banker must review)
 *   - SUSPECT is the strongest negative — no FAILED state
 */

// ── Types ─────────────────────────────────────────────────────────────

export type ExtractionQualityResult = {
  status: "PASSED" | "SUSPECT";
  reason_code: string | null;
  message: string | null;
};

/**
 * Minimal fact shape for validators.
 * Matches the fact_key / fact_value_num columns from deal_financial_facts.
 */
export type FactForValidation = {
  fact_key: string;
  fact_value_num: number | null;
  fact_value_text: string | null;
  fact_type: string;
};

// ── Constants ─────────────────────────────────────────────────────────

/** Tolerance for balance sheet equation: |assets - (liabilities + equity)| / assets */
export const BS_BALANCE_TOLERANCE = 0.05;

/** Tolerance for IS gross profit consistency: |GP - (Revenue - COGS)| / Revenue */
export const IS_GP_TOLERANCE = 0.05;

// ── Validators ────────────────────────────────────────────────────────

/**
 * Balance Sheet: assets ≈ liabilities + equity.
 *
 * Only validates if total_assets AND at least one of (total_liabilities, net_worth) exist.
 * If data insufficient → PASSED.
 * If both present and imbalance > 5% → SUSPECT.
 */
export function validateBalanceSheet(
  facts: FactForValidation[],
): ExtractionQualityResult {
  const totalAssets = findNumericFact(facts, "TOTAL_ASSETS");
  const totalLiabilities = findNumericFact(facts, "TOTAL_LIABILITIES");
  const netWorth = findNumericFact(facts, "NET_WORTH");

  // Insufficient data → PASSED (don't block on missing data)
  if (totalAssets == null) {
    return { status: "PASSED", reason_code: null, message: null };
  }

  if (totalLiabilities == null && netWorth == null) {
    return { status: "PASSED", reason_code: null, message: null };
  }

  // If assets is zero or negative, can't compute meaningful ratio
  if (totalAssets <= 0) {
    return {
      status: "SUSPECT",
      reason_code: "BS_NEGATIVE_ASSETS",
      message: `Total assets is ${totalAssets} — expected positive value`,
    };
  }

  // Check balance: assets ≈ liabilities + equity
  const otherSide =
    (totalLiabilities ?? 0) + (netWorth ?? 0);
  const imbalance = Math.abs(totalAssets - otherSide) / totalAssets;

  if (imbalance > BS_BALANCE_TOLERANCE) {
    return {
      status: "SUSPECT",
      reason_code: "BS_IMBALANCE",
      message: `Balance sheet imbalance: assets=${fmt(totalAssets)}, liabilities+equity=${fmt(otherSide)} (${(imbalance * 100).toFixed(1)}% off)`,
    };
  }

  return { status: "PASSED", reason_code: null, message: null };
}

/**
 * Income Statement: detect revenue/expense presence + gross profit consistency.
 *
 * Must detect at least one revenue signal (REVENUE, GROSS_RECEIPTS, TOTAL_INCOME_TTM, NET_INCOME)
 * OR at least one expense signal (COGS, OPEX_TTM, EBITDA).
 * If missing ALL signals → SUSPECT.
 *
 * D3 consistency check: if revenue, COGS, and gross_profit all present,
 * verify gross_profit ≈ revenue - COGS (within 5% tolerance).
 */
export function validateIncomeStatement(
  facts: FactForValidation[],
): ExtractionQualityResult {
  const revenueKeys = [
    "REVENUE",
    "GROSS_RECEIPTS",
    "TOTAL_INCOME_TTM",
    "NET_INCOME",
    "GROSS_PROFIT",
  ];
  const expenseKeys = ["COGS", "OPEX_TTM", "EBITDA"];

  const hasRevenue = revenueKeys.some((k) => findNumericFact(facts, k) != null);
  const hasExpense = expenseKeys.some((k) => findNumericFact(facts, k) != null);

  if (!hasRevenue && !hasExpense) {
    return {
      status: "SUSPECT",
      reason_code: "IS_NO_FINANCIAL_SIGNALS",
      message:
        "No revenue or expense signals found in extracted income statement",
    };
  }

  // D3: gross_profit = revenue - COGS consistency check
  const revenue = findNumericFact(facts, "REVENUE") ?? findNumericFact(facts, "GROSS_RECEIPTS");
  const cogs = findNumericFact(facts, "COGS");
  const grossProfit = findNumericFact(facts, "GROSS_PROFIT");

  if (revenue != null && cogs != null && grossProfit != null && revenue > 0) {
    const expected = revenue - cogs;
    const tolerance = Math.abs(revenue) * IS_GP_TOLERANCE;
    if (Math.abs(grossProfit - expected) > tolerance) {
      return {
        status: "SUSPECT",
        reason_code: "IS_GP_INCONSISTENCY",
        message: `Gross profit inconsistency: revenue=${fmt(revenue)}, COGS=${fmt(cogs)}, gross_profit=${fmt(grossProfit)} (expected ${fmt(expected)})`,
      };
    }
  }

  return { status: "PASSED", reason_code: null, message: null };
}

/**
 * Tax Return: check for the presence of financial signals.
 *
 * Does NOT try to balance tax math — only checks structural plausibility.
 * Year and entity metadata come from document-level fields (doc_year,
 * entity binding), not from extracted facts, so we validate based on
 * financial signal presence instead.
 */
export function validateTaxReturn(
  facts: FactForValidation[],
): ExtractionQualityResult {
  // Tax returns should have at least one income/financial signal.
  // These are the canonical keys our tax return extractor produces.
  const taxSignalKeys = [
    // Business tax return signals
    "GROSS_RECEIPTS",
    "GROSS_PROFIT",
    "TOTAL_INCOME",
    "TOTAL_DEDUCTIONS",
    "TAXABLE_INCOME",
    "NET_INCOME",
    "ORDINARY_BUSINESS_INCOME",
    "ADJUSTED_GROSS_INCOME",
    "TAX_LIABILITY",
    "WAGES_W2",
    "BUSINESS_INCOME_SCHEDULE_C",
    // Personal tax return signals (Schedule C / E / K1)
    "SCHEDULE_C_NET_PROFIT",
    "SCHEDULE_C_GROSS_RECEIPTS",
    "RENTAL_INCOME_SCHED_E",
    "K1_ORDINARY_INCOME",
    "INTEREST_INCOME",
    "DIVIDEND_INCOME",
    "CAPITAL_GAINS",
    "SOCIAL_SECURITY_INCOME",
  ];

  const hasSignal = taxSignalKeys.some(
    (k) => findNumericFact(facts, k) != null,
  );

  if (!hasSignal) {
    return {
      status: "SUSPECT",
      reason_code: "TAX_NO_FINANCIAL_SIGNALS",
      message:
        "No financial signals found in extracted tax return (no income, deductions, or tax liability)",
    };
  }

  return { status: "PASSED", reason_code: null, message: null };
}

// ── Router ────────────────────────────────────────────────────────────

/**
 * Dispatch extraction quality validation based on canonical doc type.
 * Unknown doc types → PASSED (don't block what we don't understand).
 */
export function validateExtractionQuality(
  docType: string | null,
  facts: FactForValidation[],
): ExtractionQualityResult {
  if (!docType) {
    return { status: "PASSED", reason_code: null, message: null };
  }

  const dt = docType.toUpperCase();

  if (dt === "BALANCE_SHEET") {
    return validateBalanceSheet(facts);
  }

  if (
    dt === "INCOME_STATEMENT" ||
    dt === "T12" ||
    dt === "TRAILING_12" ||
    dt === "OPERATING_STATEMENT" ||
    dt === "FINANCIAL_STATEMENT"
  ) {
    return validateIncomeStatement(facts);
  }

  if (
    dt === "BUSINESS_TAX_RETURN" ||
    dt === "PERSONAL_TAX_RETURN" ||
    dt === "IRS_1040" ||
    dt === "IRS_1120" ||
    dt === "IRS_1120S" ||
    dt === "IRS_1065" ||
    dt === "IRS_PERSONAL" ||
    dt === "IRS_BUSINESS"
  ) {
    return validateTaxReturn(facts);
  }

  // PFS — validate like balance sheet (has assets, liabilities, net worth)
  if (
    dt === "PFS" ||
    dt === "PERSONAL_FINANCIAL_STATEMENT" ||
    dt === "SBA_413"
  ) {
    return validateBalanceSheet(
      facts.map((f) => ({
        ...f,
        // Map PFS-specific keys to BS keys for validation
        fact_key: mapPfsKey(f.fact_key),
      })),
    );
  }

  // Unknown doc type → PASSED
  return { status: "PASSED", reason_code: null, message: null };
}

// ── D3: Year Mismatch Detection ─────────────────────────────────────

/**
 * Detect year mismatch between extracted year and expected slot year.
 *
 * If slot expects a specific year and extracted year differs → SUSPECT.
 * No auto-adjustment in v1 — route to review.
 */
export function validateYearConsistency(
  facts: FactForValidation[],
  expectedYear: number | null,
): ExtractionQualityResult {
  if (expectedYear == null) {
    return { status: "PASSED", reason_code: null, message: null };
  }

  const extractedYear =
    findNumericFact(facts, "TAX_YEAR") ??
    findNumericFact(facts, "FISCAL_YEAR") ??
    findNumericFact(facts, "YEAR");

  if (extractedYear == null) {
    // No year extracted → can't check, pass (don't block on missing data)
    return { status: "PASSED", reason_code: null, message: null };
  }

  if (extractedYear !== expectedYear) {
    return {
      status: "SUSPECT",
      reason_code: "YEAR_MISMATCH",
      message: `Year mismatch: extracted=${extractedYear}, expected=${expectedYear}`,
    };
  }

  return { status: "PASSED", reason_code: null, message: null };
}

// ── D1: Validation Gate (ALL checks) ────────────────────────────────

/**
 * Run ALL validation checks and return a composite result.
 *
 * Returns SUSPECT if ANY individual check returns SUSPECT.
 * Includes all individual check results as evidence.
 */
export function runValidationGate(args: {
  docType: string | null;
  facts: FactForValidation[];
  expectedYear?: number | null;
}): {
  result: ExtractionQualityResult;
  checks: Array<{ check: string; result: ExtractionQualityResult }>;
} {
  const checks: Array<{ check: string; result: ExtractionQualityResult }> = [];

  // Run type-specific validation
  const typeResult = validateExtractionQuality(args.docType, args.facts);
  checks.push({ check: "type_validation", result: typeResult });

  // Run year consistency check
  if (args.expectedYear != null) {
    const yearResult = validateYearConsistency(args.facts, args.expectedYear);
    checks.push({ check: "year_consistency", result: yearResult });
  }

  // Composite: any SUSPECT → SUSPECT
  const hasSuspect = checks.some((c) => c.result.status === "SUSPECT");

  if (hasSuspect) {
    const suspectCheck = checks.find((c) => c.result.status === "SUSPECT")!;
    return {
      result: suspectCheck.result,
      checks,
    };
  }

  return {
    result: { status: "PASSED", reason_code: null, message: null },
    checks,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

function findNumericFact(
  facts: FactForValidation[],
  factKey: string,
): number | null {
  const f = facts.find((x) => x.fact_key === factKey);
  return f?.fact_value_num ?? null;
}

function mapPfsKey(key: string): string {
  if (key === "PFS_TOTAL_ASSETS") return "TOTAL_ASSETS";
  if (key === "PFS_TOTAL_LIABILITIES") return "TOTAL_LIABILITIES";
  if (key === "PFS_NET_WORTH") return "NET_WORTH";
  return key;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
