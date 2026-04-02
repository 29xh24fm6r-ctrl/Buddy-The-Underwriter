/**
 * Polishes text for borrower consumption.
 * Pure function, no DB or server deps.
 */

export const BORROWER_TONE_RULES = {
  plain: "Use everyday language. Avoid jargon unless immediately defined.",
  respectful: "Treat the borrower as a capable business owner seeking clarity.",
  specific: "Give concrete numbers and next steps, not vague suggestions.",
  nonShaming: "Never frame financial gaps as failures. Frame them as opportunities.",
  operationallyUseful: "Every paragraph should help the borrower do something.",
  encouraging: "Acknowledge progress and strengths before addressing gaps.",
  seriousWithoutBeingPunitive: "Be honest about challenges without being discouraging.",
} as const;

const JARGON_MAP: Array<[RegExp, string]> = [
  [/\bDSCR\b/g, "loan payment coverage"],
  [/\bLTV\b/g, "loan-to-value ratio"],
  [/\bleverage ratio\b/gi, "borrowing level"],
  [/\bNOI\b/g, "net operating income"],
  [/\bdebt service\b/gi, "loan payments"],
  [/\bamortization\b/gi, "loan repayment schedule"],
];

export function polishForBorrower(text: string): string {
  let result = text;

  for (const [pattern, replacement] of JARGON_MAP) {
    result = result.replace(pattern, replacement);
  }

  // Collapse redundant whitespace
  result = result.replace(/[ \t]+/g, " ");
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}

export function formatBorrowerInsight(insight: {
  title: string;
  body: string;
  actionable?: string;
}): string {
  const lines: string[] = [];

  lines.push(`### ${insight.title}`);
  lines.push("");
  lines.push(polishForBorrower(insight.body));

  if (insight.actionable) {
    lines.push("");
    lines.push(`**What you can do:** ${insight.actionable}`);
  }

  return lines.join("\n");
}
