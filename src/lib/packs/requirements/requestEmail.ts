// src/lib/packs/requirements/requestEmail.ts

import type { RequirementResult } from "./types";

export function buildMissingDocsEmail(input: {
  borrowerName?: string;
  dealName?: string;
  results: RequirementResult[];
}) {
  const missing = input.results.filter((r) => r.status === "MISSING" || r.status === "PARTIAL");

  const lines = missing.map((r) => `- ${r.requirement.label}${r.status === "PARTIAL" ? " (partial received)" : ""}`);

  return [
    `Subject: Missing Items Needed for Underwriting${input.dealName ? ` — ${input.dealName}` : ""}`,
    ``,
    `Hi${input.borrowerName ? ` ${input.borrowerName}` : ""},`,
    ``,
    `To complete our underwriting review, please provide the following:`,
    ``,
    ...lines,
    ``,
    `If you have questions on any item, reply here and we’ll clarify exactly what we need.`,
    ``,
    `Thank you,`,
    `Old Glory Bank`,
  ].join("\n");
}