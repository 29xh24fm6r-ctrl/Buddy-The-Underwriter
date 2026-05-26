/**
 * Credit Decision Data Sufficiency Evaluator
 *
 * Determines whether Buddy has enough information for a good
 * conventional credit decision and what is missing.
 *
 * Pure function — no DB, no server-only.
 */

export type DecisionQuality = "committee_ready" | "conditional_ready" | "needs_more_data" | "not_ready";

export type SufficiencyItem = {
  category: string;
  item: string;
  present: boolean;
  required_for: "approval" | "closing" | "monitoring" | "optional";
};

export type CreditDecisionDataSufficiency = {
  decision_quality: DecisionQuality;
  missing_for_final_approval: string[];
  missing_for_closing: string[];
  missing_for_monitoring: string[];
  items_that_cap_risk_rating: string[];
  items_that_are_conditions_not_blockers: string[];
  sufficiency_items: SufficiencyItem[];
};

export type SufficiencyInput = {
  // Borrower
  hasBorrowerName: boolean;
  hasOwnership: boolean;
  hasGuarantor: boolean;
  hasManagementProfile: boolean;
  hasYearsInBusiness: boolean;

  // Request
  hasLoanAmount: boolean;
  hasProduct: boolean;
  hasPurpose: boolean;
  hasCollateral: boolean;
  hasPricing: boolean;

  // Financial
  hasIncomeStatement: boolean;
  hasBalanceSheet: boolean;
  hasDscr: boolean;
  hasTrendAnalysis: boolean;
  hasGlobalCashFlow: boolean;
  hasDebtSchedule: boolean;

  // Collateral
  hasArAging: boolean;
  hasBorrowingBase: boolean;
  hasAppraisal: boolean;

  // Guarantor
  hasPfs: boolean;
  hasPersonalIncome: boolean;
  hasPersonalDebtService: boolean;

  // Industry
  hasNaics: boolean;
  hasPeerBenchmarks: boolean;
  hasIndustryResearch: boolean;

  // Diligence
  hasAdverseMediaCheck: boolean;
  hasOfacCheck: boolean;
  hasUccSearch: boolean;
  hasTaxLienCheck: boolean;
  hasBackgroundCheck: boolean;

  // Relationship
  hasBankerNotes: boolean;
};

export function evaluateCreditDecisionDataSufficiency(
  input: SufficiencyInput,
): CreditDecisionDataSufficiency {
  const items: SufficiencyItem[] = [];
  const missingApproval: string[] = [];
  const missingClosing: string[] = [];
  const missingMonitoring: string[] = [];
  const capsRating: string[] = [];
  const conditionsNotBlockers: string[] = [];

  function check(cat: string, item: string, present: boolean, req: SufficiencyItem["required_for"]) {
    items.push({ category: cat, item, present, required_for: req });
    if (!present) {
      if (req === "approval") missingApproval.push(item);
      else if (req === "closing") missingClosing.push(item);
      else if (req === "monitoring") missingMonitoring.push(item);
    }
  }

  // Borrower / entity
  check("Borrower", "Borrower legal name", input.hasBorrowerName, "approval");
  check("Borrower", "Ownership structure", input.hasOwnership, "approval");
  check("Borrower", "Guarantor identification", input.hasGuarantor, "approval");
  check("Borrower", "Management profile", input.hasManagementProfile, "approval");

  // Request / structure
  check("Request", "Loan amount", input.hasLoanAmount, "approval");
  check("Request", "Product type", input.hasProduct, "approval");
  check("Request", "Purpose / use of proceeds", input.hasPurpose, "approval");
  check("Request", "Collateral identification", input.hasCollateral, "approval");
  check("Request", "Pricing", input.hasPricing, "closing");

  // Financial repayment
  check("Financial", "Income statements", input.hasIncomeStatement, "approval");
  check("Financial", "Balance sheet", input.hasBalanceSheet, "approval");
  check("Financial", "DSCR computation", input.hasDscr, "approval");
  check("Financial", "Trend analysis (multi-period)", input.hasTrendAnalysis, "approval");
  check("Financial", "Global cash flow", input.hasGlobalCashFlow, "approval");
  check("Financial", "Existing debt schedule", input.hasDebtSchedule, "closing");

  // Collateral detail
  check("Collateral", "AR aging report", input.hasArAging, "approval");
  check("Collateral", "Borrowing base calculation", input.hasBorrowingBase, "approval");

  // Guarantor support
  check("Guarantor", "Personal financial statement", input.hasPfs, "approval");
  check("Guarantor", "Personal income verification", input.hasPersonalIncome, "approval");
  check("Guarantor", "Personal debt service detail", input.hasPersonalDebtService, "closing");

  // Industry
  check("Industry", "NAICS classification", input.hasNaics, "approval");
  check("Industry", "Peer benchmark context", input.hasPeerBenchmarks, "optional");
  check("Industry", "Industry research", input.hasIndustryResearch, "optional");

  // Diligence
  check("Diligence", "Adverse media / litigation check", input.hasAdverseMediaCheck, "approval");
  check("Diligence", "OFAC / sanctions screening", input.hasOfacCheck, "approval");
  check("Diligence", "UCC search", input.hasUccSearch, "closing");
  check("Diligence", "Tax lien search", input.hasTaxLienCheck, "closing");
  check("Diligence", "Background / credit check", input.hasBackgroundCheck, "closing");

  // GCF incomplete is a condition, not a blocker for conditional approval
  if (!input.hasGlobalCashFlow) {
    capsRating.push("Formal GCF incomplete — caps risk rating");
    conditionsNotBlockers.push("Complete formal GCF or document exception before final approval");
  }
  if (!input.hasAdverseMediaCheck || !input.hasOfacCheck) {
    capsRating.push("Formal diligence incomplete — caps risk rating");
    conditionsNotBlockers.push("Complete adverse media, OFAC, and background checks before final approval");
  }
  if (!input.hasPersonalDebtService) {
    conditionsNotBlockers.push("Confirm guarantor recurring personal obligations before closing");
  }

  // Determine quality
  const approvalMissing = missingApproval.length;
  const criticalMissing = [!input.hasDscr, !input.hasLoanAmount, !input.hasCollateral].filter(Boolean).length;

  let quality: DecisionQuality;
  if (criticalMissing > 0) {
    quality = "not_ready";
  } else if (approvalMissing === 0 && missingClosing.length <= 3) {
    quality = "committee_ready";
  } else if (approvalMissing <= 3 && conditionsNotBlockers.length > 0) {
    quality = "conditional_ready";
  } else {
    quality = "needs_more_data";
  }

  return {
    decision_quality: quality,
    missing_for_final_approval: missingApproval,
    missing_for_closing: missingClosing,
    missing_for_monitoring: missingMonitoring,
    items_that_cap_risk_rating: capsRating,
    items_that_are_conditions_not_blockers: conditionsNotBlockers,
    sufficiency_items: items,
  };
}
