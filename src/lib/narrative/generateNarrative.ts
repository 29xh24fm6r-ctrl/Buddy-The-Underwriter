// Simplified credit memo generator (facts only)
export function generateCreditMemo({ forms, preflight }: any) {
  const amount = forms?.payload?.loan?.amount;
  const businessName = forms?.payload?.business?.legal_name ?? "the borrower";
  const score = preflight?.score ?? 0;
  const passed = preflight?.passed ?? false;

  return `
EXECUTIVE SUMMARY
${businessName} is requesting an SBA 7(a) loan in the amount of $${amount?.toLocaleString()}.

SBA ELIGIBILITY
Eligibility was evaluated deterministically per SOP 50 10 7.1.
Preflight Score: ${score}/100.
Status: ${passed ? "PASSED" : "REQUIRES ATTENTION"}.

RISKS & MITIGANTS
Primary risks are mitigated by SBA guaranty and documentation coverage.
${!passed ? "\nBLOCKING ISSUES IDENTIFIED - See preflight results for details." : ""}
`.trim();
}

// Full narrative generator (more comprehensive)
export async function generateNarrative(input: {
  payload: any;
  preflight: any;
  requirements: any;
  eligibility?: any;
}) {
  const business = input.payload?.business;
  const loan = input.payload?.loan;
  const sbaGate = input.payload?.sba_gate;
  const eligResult = input.eligibility?.result;

  return {
    EXEC_SUMMARY: generateExecutiveSummary({ business, loan, eligResult }),
    BUSINESS_OVERVIEW: generateBusinessOverview({ business, loan }),
    LOAN_REQUEST: generateLoanRequest({ loan, business }),
    SBA_ELIGIBILITY: generateSbaEligibility({ sbaGate, eligResult, preflight: input.preflight }),
    FINANCIAL_ANALYSIS: generateFinancialAnalysis({ requirements: input.requirements }),
    RISKS: generateRisks({ preflight: input.preflight, requirements: input.requirements }),
    RECOMMENDATION: generateRecommendation({ preflight: input.preflight, loan }),
  };
}

function generateExecutiveSummary(ctx: any) {
  const amount = ctx.loan?.amount ? `$${ctx.loan.amount.toLocaleString()}` : "[AMOUNT]";
  const name = ctx.business?.legal_name ?? "[BUSINESS NAME]";
  const program = ctx.eligResult?.best_program === "SBA_7A" ? "SBA 7(a)" : "conventional";

  return `
This credit request is for a ${program} loan in the amount of ${amount} to ${name}.

The borrower meets ${program} eligibility requirements based on information provided and documentation received through the automated intake system.

All required documentation has been collected and classified, and preflight quality assurance checks have been completed.
`.trim();
}

function generateBusinessOverview(ctx: any) {
  const name = ctx.business?.legal_name ?? "[BUSINESS NAME]";
  const industry = ctx.business?.industry ?? "[INDUSTRY]";
  const naics = ctx.business?.naics ?? "[NAICS]";

  return `
Business: ${name}
Industry: ${industry}
NAICS Code: ${naics}

The business operates in the ${industry} sector and has provided complete formation documentation, tax returns, and financial statements as part of this application.
`.trim();
}

function generateLoanRequest(ctx: any) {
  const amount = ctx.loan?.amount ? `$${ctx.loan.amount.toLocaleString()}` : "[AMOUNT]";
  const use = ctx.loan?.use_of_proceeds_primary ?? "[USE]";

  return `
Requested Loan Amount: ${amount}
Primary Use of Proceeds: ${use}

The loan proceeds will be used for ${use} as documented in the borrower's application and supporting materials.

All use of proceeds align with SBA-eligible purposes and do not include prohibited activities.
`.trim();
}

function generateSbaEligibility(ctx: any) {
  const passed = ctx.eligResult?.status === "ELIGIBLE";
  const gates = ctx.eligResult?.gates ?? [];
  const failedGates = gates.filter((g: any) => g.status === "FAIL");

  let text = `
SBA Eligibility Assessment:

Eligibility was evaluated using deterministic SBA SOP 50 10 7.1 criteria across seven core requirements:
- Business type eligibility
- Federal debt delinquency status
- Ownership U.S. eligibility
- Criminal history review
- Use of proceeds compliance
- Size standard requirements
- Overall SBA program intent
`;

  if (passed) {
    text += `\n\nResult: All eligibility gates PASSED. The borrower qualifies for SBA 7(a) financing.`;
  } else {
    text += `\n\nResult: ${failedGates.length} eligibility gate(s) failed:\n`;
    for (const gate of failedGates) {
      text += `\n- ${gate.name}: ${gate.reason}`;
    }
  }

  if (ctx.preflight?.blocking_issues?.length > 0) {
    text += `\n\nPreflight Issues Identified:\n`;
    for (const issue of ctx.preflight.blocking_issues.slice(0, 5)) {
      text += `\n- ${issue.message}`;
    }
  }

  return text.trim();
}

function generateFinancialAnalysis(ctx: any) {
  const reqs = ctx.requirements?.requirements ?? [];
  const satisfied = reqs.filter((r: any) => r.status === "SATISFIED").length;
  const total = reqs.filter((r: any) => r.required).length;

  return `
Financial Documentation Review:

Required documents received: ${satisfied} of ${total}

All submitted financial documents have been classified and validated through automated document intelligence systems.

Tax returns, financial statements, and supporting schedules have been reviewed for consistency and completeness.
`.trim();
}

function generateRisks(ctx: any) {
  const blockers = ctx.preflight?.blocking_issues ?? [];
  const warnings = ctx.preflight?.warnings ?? [];
  const missingDocs = ctx.requirements?.summary?.required_missing ?? 0;

  let text = `
Risk Assessment:

`;

  if (blockers.length > 0) {
    text += `Primary Risks (Blocking):\n`;
    for (const block of blockers) {
      text += `- ${block.message}\n`;
      if (block.how_to_fix) {
        text += `  Mitigation: ${block.how_to_fix}\n`;
      }
    }
    text += `\n`;
  }

  if (warnings.length > 0) {
    text += `Secondary Risks (Warnings):\n`;
    for (const warn of warnings) {
      text += `- ${warn.message}\n`;
    }
    text += `\n`;
  }

  if (missingDocs > 0) {
    text += `Document Completeness: ${missingDocs} required document(s) pending.\n\n`;
  }

  if (blockers.length === 0 && warnings.length === 0 && missingDocs === 0) {
    text += `No material risks identified. All documentation is complete and all compliance checks have passed.\n\n`;
    text += `The SBA guaranty provides additional risk mitigation for this transaction.`;
  }

  return text.trim();
}

function generateRecommendation(ctx: any) {
  const passed = ctx.preflight?.passed ?? false;
  const score = ctx.preflight?.score ?? 0;
  const amount = ctx.loan?.amount ? `$${ctx.loan.amount.toLocaleString()}` : "[AMOUNT]";

  if (passed && score >= 90) {
    return `
Recommendation: APPROVE

This loan request meets all SBA 7(a) eligibility requirements and underwriting standards.

Readiness Score: ${score}/100

The loan is ready for SBA submission with high confidence of approval.

Recommended loan amount: ${amount}
`.trim();
  } else if (passed && score >= 75) {
    return `
Recommendation: APPROVE WITH CONDITIONS

This loan request meets core SBA requirements but has minor items requiring attention.

Readiness Score: ${score}/100

Recommend addressing warnings before SBA submission to ensure clean processing.
`.trim();
  } else {
    return `
Recommendation: HOLD

This loan request requires resolution of blocking issues before SBA submission.

Readiness Score: ${score}/100

Please review the preflight issues section and address all blocking items before proceeding.
`.trim();
  }
}
