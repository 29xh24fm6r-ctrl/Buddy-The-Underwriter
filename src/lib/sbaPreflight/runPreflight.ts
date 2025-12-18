import type { PreflightIssue, PreflightResult } from "./types";
import { explainPreflightIssue } from "./explainIssue";

export function runSbaPreflight(input: {
  answers: Record<string, any>;
  formPayload: any;
  requirements: any; // BorrowerRequirementsResult
  attachments: any[];
}): PreflightResult {
  const blocks: PreflightIssue[] = [];
  const warns: PreflightIssue[] = [];

  /* -------------------------------
     1. Forms vs Answers consistency
  --------------------------------*/
  if (
    input.answers["business.legal_name"] &&
    input.formPayload?.business?.legal_name &&
    input.answers["business.legal_name"] !== input.formPayload.business.legal_name
  ) {
    blocks.push({
      code: "BUSINESS_NAME_MISMATCH",
      message: "Business legal name differs between answers and form payload.",
      severity: "BLOCK",
      evidence: { source: "FORM", ref: "business.legal_name" },
    });
  }

  /* -------------------------------
     2. SBA gate contradictions
  --------------------------------*/
  if (
    input.answers["sba.flags.federal_debt_delinquent"] === true &&
    input.formPayload?.sba_gate?.federal_debt_delinquent !== true
  ) {
    blocks.push({
      code: "FEDERAL_DEBT_CONTRADICTION",
      message: "Federal debt delinquency answer conflicts with form data.",
      severity: "BLOCK",
      evidence: { source: "ANSWER", ref: "sba.flags.federal_debt_delinquent" },
    });
  }

  /* -------------------------------
     3. Checklist coverage
  --------------------------------*/
  const missingRequired =
    input.requirements?.requirements?.filter(
      (r: any) => r.required && (r.status === "MISSING" || r.status === "PARTIAL")
    ) ?? [];

  if (missingRequired.length > 0) {
    blocks.push({
      code: "MISSING_REQUIRED_DOCS",
      message: `Missing ${missingRequired.length} required SBA document(s).`,
      severity: "BLOCK",
      evidence: { source: "CHECKLIST" },
    });
  }

  /* -------------------------------
     4. Document quality warnings
  --------------------------------*/
  for (const a of input.attachments ?? []) {
    const conf =
      a?.meta?.confidence ??
      a?.meta?.classification?.confidence ??
      null;

    if (typeof conf === "number" && conf < 0.65) {
      warns.push({
        code: "LOW_CONFIDENCE_DOC",
        message: "One or more documents were classified with low confidence.",
        severity: "WARN",
        evidence: { source: "DOCUMENT", ref: a.file_key },
      });
      break;
    }
  }

  /* -------------------------------
     5. Score computation
  --------------------------------*/
  let score = 100;
  score -= blocks.length * 25;
  score -= warns.length * 5;
  score = Math.max(0, Math.min(100, score));

  const explainedBlocks = blocks.map(explainPreflightIssue);
  const explainedWarns = warns.map(explainPreflightIssue);

  return {
    score,
    passed: explainedBlocks.length === 0,
    blocking_issues: explainedBlocks,
    warnings: explainedWarns,
  };
}
