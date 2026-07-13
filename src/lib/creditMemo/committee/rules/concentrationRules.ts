// Pure concentration / customer rules — keyword-driven, conservative.
// We don't try to extract concentration percentages from prose; we flag
// when the banker has *acknowledged* concentration in the borrower story
// or when the field is suspiciously empty for a single-customer narrative.

import type { CommitteeObjection, CommitteeRule } from "../types";

// Negation-aware patterns: do not match phrasings prefixed by "no" / "not"
// (e.g. "No single customer above 10%" should NOT trigger a concentration
// objection). The negation window tolerates a determiner between the
// negation word and the phrase (e.g. "does not have A single customer",
// "without ANY single customer") — a bare `(?:no|not)\s` lookbehind only
// catches negation words sitting immediately before the phrase and misses
// this common construction, which reads it as a disclosed concentration
// when the sentence actually disclaims one. Lookbehind keeps the rule
// pure-regex without splitting text.
const NEGATION = "(?:no|not|never|without)\\s(?:a|an|any)?\\s?";
const HIGH_CONCENTRATION_HINTS = [
  new RegExp(`(?<!\\b${NEGATION})single\\s+customer`, "i"),
  new RegExp(`(?<!\\b${NEGATION})sole\\s+customer`, "i"),
  /one\s+(?:major|primary|key)\s+customer/i,
  /\b(?:7[0-9]|8[0-9]|9[0-9]|100)\s*%\s+(?:of|from|with)/i,
  /concentrated\s+in\s+\w+/i,
];

const MODERATE_CONCENTRATION_HINTS = [
  /top\s+(?:two|three|2|3)\s+customers/i,
  new RegExp(`(?<!\\b${NEGATION})concentration\\s+risk`, "i"),
  /\b(?:4[0-9]|5[0-9]|6[0-9])\s*%\s+(?:of|from|with)/i,
];

export const concentrationRules: CommitteeRule = (inputs) => {
  const out: CommitteeObjection[] = [];
  const dealId = inputs.dealId;
  const text = `${inputs.memoInput.borrowerStoryConcentration ?? ""} ${
    inputs.memoInput.borrowerStoryCustomers ?? ""
  }`.trim();

  if (!text) return out;

  const high = HIGH_CONCENTRATION_HINTS.some((re) => re.test(text));
  const moderate = MODERATE_CONCENTRATION_HINTS.some((re) => re.test(text));

  if (high) {
    out.push({
      code: "concentration_customer_high",
      domain: "concentration",
      severity: "hard",
      label: "High customer concentration disclosed",
      rationale:
        "Borrower story discloses single-customer or >70% revenue concentration — committee will probe contract terms and renewal risk.",
      mitigant:
        "Document contract length, termination provisions, and historical renewal rate; consider customer-specific covenants.",
      fixPath: `/deals/${dealId}/memo-inputs#borrower-story`,
      source: { metric: "borrower_story_concentration", value: "high" },
    });
  } else if (moderate) {
    out.push({
      code: "concentration_customer_moderate",
      domain: "concentration",
      severity: "soft",
      label: "Moderate customer concentration disclosed",
      rationale:
        "Top customers account for a meaningful share of revenue — expect committee questions on diversification trajectory.",
      fixPath: `/deals/${dealId}/memo-inputs#borrower-story`,
      source: { metric: "borrower_story_concentration", value: "moderate" },
    });
  }

  return out;
};
