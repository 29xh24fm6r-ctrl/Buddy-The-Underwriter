// src/lib/sba7a/eligibility.ts

export type SbaEligibilityStatus = "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN";

export type SbaEligibilityReason = {
  code: string;
  message: string;
  severity: "blocker" | "warning" | "info";
  field?: string;
};

export type SbaEligibilityResult = {
  status: SbaEligibilityStatus;
  reasons: SbaEligibilityReason[];
  confidence: number; // 0..1 deterministic confidence based on completeness
  evaluated_at: string;
};

export type BorrowerDataFromAnswers = {
  borrower_name?: string | null;
  borrower_email?: string | null;
  business_name?: string | null;
  entity_type?: string | null;
  naics?: string | null;
  use_of_proceeds?: string | null;
  loan_amount?: number | null;
};

/**
 * Extract lightweight borrower context from answers for logging / message drafts / decision packets.
 * Keep this PURE + deterministic.
 */
export function extractBorrowerDataFromAnswers(
  answers: Record<string, any> | null | undefined
): BorrowerDataFromAnswers {
  const a = answers ?? {};

  const loanAmount =
    a.loan_amount != null && a.loan_amount !== ""
      ? Number(a.loan_amount)
      : null;

  return {
    borrower_name: a.borrower_name ?? a.name ?? null,
    borrower_email: a.borrower_email ?? a.email ?? null,
    business_name: a.business_name ?? a.company_name ?? null,
    entity_type: a.entity_type ?? a.legal_entity_type ?? null,
    naics: a.naics ?? a.naics_code ?? null,
    use_of_proceeds: a.use_of_proceeds ?? a.proceeds ?? null,
    loan_amount: Number.isFinite(loanAmount as number) ? (loanAmount as number) : null,
  };
}

/**
 * Deterministic SBA 7(a) eligibility evaluation.
 * This is intentionally conservative: if blockers are unknown, we return UNKNOWN.
 *
 * Expand this over time with:
 * - NAICS ineligible list checks
 * - size standards checks
 * - citizenship / ownership tests
 * - delinquent federal debt checks
 * - criminal history / debarment checks
 * - DSCR / repayment ability gating (advisory)
 */
export function evaluateSba7aEligibility(input: {
  answers?: Record<string, any> | null;
}): SbaEligibilityResult {
  const evaluated_at = new Date().toISOString();
  const answers = input.answers ?? {};

  const reasons: SbaEligibilityReason[] = [];
  const completenessFlags: boolean[] = [];

  // Helper to read booleans safely (supports "yes"/"no"/true/false/1/0)
  const readBool = (v: any): boolean | null => {
    if (v === true || v === "true" || v === 1 || v === "1" || v === "yes" || v === "YES") return true;
    if (v === false || v === "false" || v === 0 || v === "0" || v === "no" || v === "NO") return false;
    return null;
  };

  // -----------------------------
  // Core SBA “big blockers”
  // -----------------------------

  // 1) Is this a for-profit operating business?
  const forProfit = readBool(answers.for_profit ?? answers.is_for_profit);
  if (forProfit === null) {
    reasons.push({
      code: "MISSING_FOR_PROFIT",
      message: "For SBA 7(a), borrower business must be for-profit (answer missing).",
      severity: "warning",
      field: "for_profit",
    });
    completenessFlags.push(false);
  } else {
    completenessFlags.push(true);
    if (forProfit === false) {
      reasons.push({
        code: "NOT_FOR_PROFIT",
        message: "SBA 7(a) is generally not available for not-for-profit entities.",
        severity: "blocker",
        field: "for_profit",
      });
    }
  }

  // 2) Is the business operating in the U.S.?
  const usOps = readBool(answers.operates_in_us ?? answers.us_operations);
  if (usOps === null) {
    reasons.push({
      code: "MISSING_US_OPERATIONS",
      message: "Need confirmation the business operates in the United States.",
      severity: "warning",
      field: "operates_in_us",
    });
    completenessFlags.push(false);
  } else {
    completenessFlags.push(true);
    if (usOps === false) {
      reasons.push({
        code: "NON_US_OPERATIONS",
        message: "SBA 7(a) generally requires U.S. operations.",
        severity: "blocker",
        field: "operates_in_us",
      });
    }
  }

  // 3) Is the business engaged in ineligible activities? (placeholder gate)
  const ineligibleActivity = readBool(
    answers.ineligible_activity ?? answers.is_ineligible_activity
  );
  if (ineligibleActivity === null) {
    reasons.push({
      code: "MISSING_INELIGIBLE_ACTIVITY",
      message: "Need confirmation business is not engaged in SBA-ineligible activities.",
      severity: "warning",
      field: "ineligible_activity",
    });
    completenessFlags.push(false);
  } else {
    completenessFlags.push(true);
    if (ineligibleActivity === true) {
      reasons.push({
        code: "INELIGIBLE_ACTIVITY",
        message: "Business appears to be engaged in SBA-ineligible activity.",
        severity: "blocker",
        field: "ineligible_activity",
      });
    }
  }

  // 4) Any delinquent federal debt? (placeholder gate)
  const delinquentFedDebt = readBool(
    answers.delinquent_federal_debt ?? answers.has_delinquent_federal_debt
  );
  if (delinquentFedDebt === null) {
    reasons.push({
      code: "MISSING_FED_DEBT",
      message: "Need confirmation there is no delinquent federal debt.",
      severity: "warning",
      field: "delinquent_federal_debt",
    });
    completenessFlags.push(false);
  } else {
    completenessFlags.push(true);
    if (delinquentFedDebt === true) {
      reasons.push({
        code: "DELINQUENT_FED_DEBT",
        message: "Delinquent federal debt is typically an SBA eligibility blocker.",
        severity: "blocker",
        field: "delinquent_federal_debt",
      });
    }
  }

  // 5) Ownership / citizenship / lawful presence (placeholder gate)
  const ownershipOk = readBool(answers.ownership_eligibility_ok ?? answers.owners_eligible);
  if (ownershipOk === null) {
    reasons.push({
      code: "MISSING_OWNERSHIP_ELIGIBILITY",
      message: "Need confirmation owners meet SBA eligibility requirements (citizenship / lawful presence / etc.).",
      severity: "warning",
      field: "ownership_eligibility_ok",
    });
    completenessFlags.push(false);
  } else {
    completenessFlags.push(true);
    if (ownershipOk === false) {
      reasons.push({
        code: "OWNERSHIP_INELIGIBLE",
        message: "Owners appear not to meet SBA eligibility requirements.",
        severity: "blocker",
        field: "ownership_eligibility_ok",
      });
    }
  }

  // -----------------------------
  // Decide status
  // -----------------------------
  const hasBlockers = reasons.some((r) => r.severity === "blocker");
  const completeness =
    completenessFlags.length === 0
      ? 0
      : completenessFlags.filter(Boolean).length / completenessFlags.length;

  let status: SbaEligibilityStatus = "UNKNOWN";
  if (hasBlockers) status = "INELIGIBLE";
  else if (completeness >= 0.8) status = "ELIGIBLE";
  else status = "UNKNOWN";

  // Add friendly “what to do next”
  if (status === "UNKNOWN") {
    reasons.push({
      code: "MORE_INFO_NEEDED",
      message: "More answers are required before SBA 7(a) eligibility can be determined.",
      severity: "info",
    });
  }

  // Deterministic confidence = completeness for now
  const confidence = Math.max(0, Math.min(1, completeness));

  return { status, reasons, confidence, evaluated_at };
}
