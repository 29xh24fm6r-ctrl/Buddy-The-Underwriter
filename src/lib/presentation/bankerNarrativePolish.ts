/**
 * Polishes text for banker consumption.
 * Pure function, no DB or server deps.
 */

export const BANKER_TONE_RULES = {
  crisp: "Sentences should be direct and concise.",
  institutional: "Use professional banking terminology appropriate for credit committees.",
  evidenceAware: "Ground assertions in observable data points.",
  economical: "Eliminate filler and redundancy. Every sentence must earn its place.",
  noAiFiller: "Remove hedging phrases, throat-clearing, and AI-style qualifiers.",
} as const;

const FILLER_PHRASES = [
  "It's important to note that",
  "In conclusion",
  "As mentioned",
  "It should be noted",
  "Essentially",
  "Basically",
  "In terms of",
];

// Build case-insensitive patterns that match the phrase at word boundaries
const FILLER_PATTERNS = FILLER_PHRASES.map(
  (phrase) => new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "gi"),
);

export function polishForBanker(text: string): string {
  let result = text;

  for (const pattern of FILLER_PATTERNS) {
    result = result.replace(pattern, "");
  }

  // Collapse redundant whitespace
  result = result.replace(/[ \t]+/g, " ");
  // Collapse multiple newlines into at most two
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}

export function formatBankerInsight(insight: {
  title: string;
  body: string;
  confidence: string;
  evidence?: string;
}): string {
  const lines: string[] = [];

  lines.push(`### ${insight.title}`);
  lines.push("");
  lines.push(polishForBanker(insight.body));

  if (insight.evidence) {
    lines.push("");
    lines.push(`**Evidence:** ${insight.evidence}`);
  }

  lines.push("");
  lines.push(`_Confidence: ${insight.confidence}_`);

  return lines.join("\n");
}
