/**
 * Phase 54A — Borrower Condition Copy Formatter
 *
 * Converts internal condition language into plain-language
 * borrower-safe text. No policy jargon, no "blocker" language,
 * no unexplained internal statuses.
 */

export type BorrowerConditionCopy = {
  title: string;
  explanation: string;
  itemsNeeded: string[];
  examples: string[];
};

type ConditionInput = {
  title: string;
  description?: string | null;
  category?: string | null;
  required_docs?: Array<{ key?: string; label?: string; optional?: boolean }> | null;
  ai_explanation?: string | null;
  severity?: string | null;
};

/** Category-specific context strings */
const CATEGORY_CONTEXT: Record<string, string> = {
  policy: "This is required by your lender's underwriting guidelines.",
  credit: "This helps us evaluate your creditworthiness and ability to repay.",
  legal: "This is a legal requirement for closing.",
  closing: "This is needed before we can finalize your loan.",
  other: "This is needed to move your application forward.",
};

/** Fallback explanations when no description or AI explanation exists */
const SEVERITY_CONTEXT: Record<string, string> = {
  REQUIRED: "This item is required before your loan can proceed.",
  IMPORTANT: "This item is important for a smooth closing process.",
  FYI: "This would be helpful but is not strictly required.",
};

/**
 * Format a condition record into borrower-safe copy.
 * Pure function — no DB calls.
 */
export function formatBorrowerConditionCopy(input: ConditionInput): BorrowerConditionCopy {
  const title = cleanTitle(input.title);

  // Build explanation from best available source
  const explanation = buildExplanation(input);

  // Extract items needed from required_docs
  const itemsNeeded = (input.required_docs ?? [])
    .filter((d) => !d.optional)
    .map((d) => d.label ?? d.key ?? "Supporting document")
    .filter(Boolean);

  // If no specific items listed, provide generic guidance
  if (itemsNeeded.length === 0) {
    itemsNeeded.push("Upload the requested document");
  }

  // Generate examples based on category
  const examples = generateExamples(input.category, input.title);

  return { title, explanation, itemsNeeded, examples };
}

function cleanTitle(raw: string): string {
  // Remove internal prefixes like "COND:" or "POLICY:" if present
  return raw
    .replace(/^(COND|POLICY|REQ|CONDITION):\s*/i, "")
    .trim();
}

function buildExplanation(input: ConditionInput): string {
  // Priority: AI explanation > description > category context > severity context
  if (input.ai_explanation?.trim()) {
    return input.ai_explanation.trim();
  }
  if (input.description?.trim()) {
    return input.description.trim();
  }
  const cat = input.category?.toLowerCase() ?? "other";
  if (CATEGORY_CONTEXT[cat]) {
    return CATEGORY_CONTEXT[cat];
  }
  const sev = input.severity?.toUpperCase() ?? "REQUIRED";
  return SEVERITY_CONTEXT[sev] ?? SEVERITY_CONTEXT.REQUIRED;
}

function generateExamples(category?: string | null, title?: string): string[] {
  const titleLower = (title ?? "").toLowerCase();

  if (titleLower.includes("tax return") || titleLower.includes("tax")) {
    return ["IRS Form 1040", "Business tax return (1120/1120S/1065)", "K-1 schedule"];
  }
  if (titleLower.includes("bank statement")) {
    return ["Most recent 3 months of business bank statements"];
  }
  if (titleLower.includes("financial statement") || titleLower.includes("pfs")) {
    return ["Personal Financial Statement (SBA Form 413)", "Balance sheet"];
  }
  if (titleLower.includes("insurance") || titleLower.includes("hazard")) {
    return ["Certificate of insurance", "Hazard insurance declaration page"];
  }
  if (titleLower.includes("lease") || titleLower.includes("rent roll")) {
    return ["Current lease agreement", "Rent roll for most recent period"];
  }
  if (titleLower.includes("appraisal")) {
    return ["Property appraisal report"];
  }
  if (titleLower.includes("entity") || titleLower.includes("articles")) {
    return ["Articles of incorporation", "Operating agreement", "Certificate of good standing"];
  }

  // No specific examples for this condition
  return [];
}
