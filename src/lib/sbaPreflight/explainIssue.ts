import { SOP_REFS } from "@/lib/sbaKnowledge/sopReferences";

export function explainPreflightIssue(issue: {
  code: string;
  message: string;
}) {
  const ref = SOP_REFS[issue.code];

  return {
    ...issue,
    explanation: ref
      ? `This issue is governed by ${ref.title}.`
      : "This issue relates to SBA underwriting requirements.",
    sop: ref
      ? {
          citation: ref.citation,
          url: ref.url,
        }
      : null,
    how_to_fix: suggestFix(issue.code),
  };
}

function suggestFix(code: string): string {
  switch (code) {
    case "FEDERAL_DEBT_DELINQUENT":
      return "Confirm delinquency is resolved or provide documentation showing repayment or resolution.";
    case "INELIGIBLE_BUSINESS":
      return "Confirm NAICS classification or restructure transaction to remove ineligible activity.";
    case "MISSING_REQUIRED_DOCS":
      return "Upload the missing required SBA documents shown in the checklist.";
    case "BUSINESS_NAME_MISMATCH":
      return "Ensure business legal name matches tax returns, formation docs, and SBA forms.";
    case "CRIMINAL_HISTORY_FLAG":
      return "Complete SBA character determination documentation if applicable.";
    default:
      return "Review the issue and provide supporting documentation or corrections.";
  }
}
