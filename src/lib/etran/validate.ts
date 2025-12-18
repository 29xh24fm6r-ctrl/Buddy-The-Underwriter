export function validateEtran(input: { forms: any; preflight: any }) {
  const blockers: string[] = [];
  
  if (!input.preflight?.passed) blockers.push("Preflight failed");
  if (input.forms?.status !== "READY") blockers.push("Forms not ready");
  
  return { 
    ready: blockers.length === 0, 
    blockers 
  };
}

// Extended validation for comprehensive checks
export function validateEtranExtended(input: {
  forms: any;
  preflight: any;
  requirements: any;
  narrative: any;
}) {
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Critical checks (blocking)
  if (!input.preflight?.passed) {
    blockers.push("Preflight failed - resolve all blocking issues");
  }

  if (input.forms?.status !== "READY") {
    blockers.push("Forms validation failed - fix form errors");
  }

  const missingDocs = input.requirements?.summary?.required_missing ?? 0;
  if (missingDocs > 0) {
    blockers.push(`Missing ${missingDocs} required SBA document(s)`);
  }

  if (!input.narrative || Object.keys(input.narrative).length === 0) {
    blockers.push("Credit narrative not generated");
  }

  // Business name validation
  const businessName = input.forms?.payload?.business?.legal_name;
  if (!businessName || businessName.length < 3) {
    blockers.push("Business legal name is required");
  }

  // EIN validation
  const ein = input.forms?.payload?.business?.ein;
  if (ein) {
    const einDigits = ein.replace(/[^0-9]/g, "");
    if (einDigits.length !== 9) {
      warnings.push("EIN should have 9 digits for E-Tran submission");
    }
  } else {
    blockers.push("EIN is required for E-Tran submission");
  }

  // Loan amount validation
  const loanAmount = input.forms?.payload?.loan?.amount;
  if (!loanAmount || loanAmount <= 0) {
    blockers.push("Valid loan amount is required");
  }

  // SBA gate checks
  if (input.forms?.payload?.sba_gate?.want_sba !== true) {
    blockers.push("Borrower must confirm SBA program intent");
  }

  // Readiness score check
  const score = input.preflight?.score ?? 0;
  if (score < 75) {
    warnings.push("Readiness score below recommended threshold (75) - consider additional review");
  }

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    score,
    etran_eligible: blockers.length === 0 && warnings.length <= 2,
  };
}
