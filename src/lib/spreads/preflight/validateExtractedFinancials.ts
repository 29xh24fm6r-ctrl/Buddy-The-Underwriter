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
 * Income Statement: detect revenue/expense presence.
 *
 * Must detect at least one revenue signal (REVENUE, GROSS_RECEIPTS, TOTAL_INCOME_TTM, NET_INCOME)
 * OR at least one expense signal (COGS, OPEX_TTM, EBITDA).
 * If missing ALL signals → SUSPECT.
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

  return { status: "PASSED", reason_code: null, message: null };
}

/**
 * Tax Return: year and entity name required.
 *
 * Does NOT try to balance tax math — only checks structural fields.
 */
export function validateTaxReturn(
  facts: FactForValidation[],
): ExtractionQualityResult {
  // Look for year in fact_value_num on a year-related fact
  const yearFacts = facts.filter(
    (f) =>
      f.fact_key === "TAX_YEAR" ||
      f.fact_key === "FISCAL_YEAR" ||
      f.fact_key === "YEAR",
  );
  const hasYear =
    yearFacts.length > 0 && yearFacts.some((f) => f.fact_value_num != null);

  // Look for entity/business name in fact_value_text
  const entityFacts = facts.filter(
    (f) =>
      f.fact_key === "ENTITY_NAME" ||
      f.fact_key === "BUSINESS_NAME" ||
      f.fact_key === "TAXPAYER_NAME",
  );
  const hasEntity =
    entityFacts.length > 0 &&
    entityFacts.some(
      (f) => f.fact_value_text != null && f.fact_value_text.trim().length > 0,
    );

  if (!hasYear) {
    return {
      status: "SUSPECT",
      reason_code: "TAX_MISSING_YEAR",
      message: "Tax return extraction missing year field",
    };
  }

  if (!hasEntity) {
    return {
      status: "SUSPECT",
      reason_code: "TAX_MISSING_ENTITY",
      message: "Tax return extraction missing entity/taxpayer name",
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
