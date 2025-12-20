export type SbaProduct = "7a" | "504" | "express";
export type SbaStatus = "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN";

export type SbaEligibility = {
  product: SbaProduct;
  status: SbaStatus;
  reasons: string[];
  signals: Record<string, any>;
};

function toBool(v: any): boolean | null {
  if (v === true || v === "true" || v === "TRUE" || v === 1 || v === "1") return true;
  if (v === false || v === "false" || v === "FALSE" || v === 0 || v === "0") return false;
  return null;
}

function toNumber(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,]/g, "").trim();
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Deterministic rules (conservative):
 * - If a hard requirement is explicitly false => INELIGIBLE
 * - If requirements missing/unknown => UNKNOWN
 * - If all required true + thresholds consistent => ELIGIBLE
 *
 * NOTE: NAICS/size standards can be expanded later using real tables.
 */
export function evaluateSba(opts: {
  product: SbaProduct;
  answers: Record<string, any>;
}): SbaEligibility {
  const { product, answers } = opts;
  const reasons: string[] = [];

  const is_for_profit = toBool(answers.is_for_profit);
  const is_us_based = toBool(answers.is_us_based);
  const has_size_standard_compliant = toBool(
    answers.has_sba_size_standard_compliant ??
      answers.has_size_standard_compliant ??
      answers.size_standard_compliant
  );

  const loan_amount = toNumber(answers.loan_amount ?? answers.requested_amount);
  const annual_revenue = toNumber(answers.annual_revenue ?? answers.revenue);
  const num_employees = toNumber(answers.num_employees ?? answers.employees);

  // Common hard requirements
  if (is_for_profit === false) reasons.push("Applicant is not for-profit.");
  if (is_us_based === false) reasons.push("Applicant is not U.S.-based.");
  if (has_size_standard_compliant === false) reasons.push("Applicant does not meet SBA size standards.");

  // Product-specific heuristics (deterministic but not "guesses")
  if (product === "express") {
    // Express is a subset program; we keep it conservative: loan amount must be provided and <= a configurable cap later.
    if (loan_amount == null) reasons.push("Loan amount not provided (needed for SBA Express screening).");
  }

  if (product === "504") {
    // 504 typically requires fixed assets / real estate / equipment; we flag missing signals deterministically.
    const has_fixed_asset_purpose = toBool(answers.has_fixed_asset_purpose ?? answers.fixed_asset_purpose);
    if (has_fixed_asset_purpose === false) reasons.push("Purpose not fixed-asset oriented (typical 504 requirement).");
    if (has_fixed_asset_purpose === null) reasons.push("Purpose (fixed-asset) not provided for 504 screening.");
  }

  // Status resolution
  let status: SbaStatus = "UNKNOWN";

  const hardFail =
    is_for_profit === false || is_us_based === false || has_size_standard_compliant === false;

  if (hardFail) {
    status = "INELIGIBLE";
  } else {
    // We only mark ELIGIBLE when required inputs are explicitly true.
    const requiredKnownTrue =
      is_for_profit === true && is_us_based === true && has_size_standard_compliant === true;

    if (requiredKnownTrue) {
      status = "ELIGIBLE";
    } else {
      status = "UNKNOWN";
      if (is_for_profit === null) reasons.push("For-profit status not provided.");
      if (is_us_based === null) reasons.push("U.S.-based status not provided.");
      if (has_size_standard_compliant === null) reasons.push("Size standard compliance not provided.");
    }
  }

  // Helpful signal notes
  if (loan_amount == null) reasons.push("Loan amount not provided.");
  if (annual_revenue == null) reasons.push("Annual revenue not provided.");
  if (num_employees == null) reasons.push("Employee count not provided.");

  return {
    product,
    status,
    reasons,
    signals: {
      loan_amount,
      annual_revenue,
      num_employees,
      is_for_profit,
      is_us_based,
      has_size_standard_compliant,
    },
  };
}
