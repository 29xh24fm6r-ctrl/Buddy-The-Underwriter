/**
 * Pure intent detector for borrower concierge messages that should route to
 * the Trident preview package.
 *
 * Why: when a borrower asks for a business plan / feasibility study /
 * projections / lender-ready package — OR asks generically to "see what we
 * built" / "show me the docs" / "give me the package" — the concierge MUST
 * NOT fall back to LLM section-by-section generation, "copy/paste into a
 * template", or "I can't generate documents". It owns the canonical preview
 * response and triggers the existing trident bundle generator.
 *
 * Pure (no I/O, no DB, no LLM) so it can run BEFORE the extraction LLM
 * and short-circuit the entire concierge turn. Imported by both text and
 * voice surfaces so the trigger is identical across channels.
 */

export const TRIDENT_PREVIEW_RESPONSE =
  "I can generate a preview package inside Buddy. The full package unlocks when you pick a lender.";

export type TridentIntent =
  | "business_plan"
  | "feasibility"
  | "projections"
  | "lender_ready_package";

export type TridentIntentMatch = {
  matched: true;
  intent: TridentIntent;
  matchedTerm: string;
};

export type TridentIntentMiss = { matched: false };

export type TridentIntentResult = TridentIntentMatch | TridentIntentMiss;

/**
 * Strong, unambiguous deliverable nouns. These trigger on their own — no
 * accompanying request verb needed. ("I'm building a business plan" still
 * routes to preview because the borrower is invoking the deliverable; if
 * they wanted an unrelated thread we'd already be off-topic.)
 */
const STRONG_NOUN_PATTERNS: ReadonlyArray<{
  re: RegExp;
  intent: TridentIntent;
}> = [
  { re: /\bbusiness[\s-]*plan\b/i, intent: "business_plan" },
  {
    re: /\bfeasibility(?:[\s-]*stud(?:y|ies))?\b/i,
    intent: "feasibility",
  },
  { re: /\bprojections?\b/i, intent: "projections" },
  { re: /\bproforma\b/i, intent: "projections" },
  { re: /\bpro[\s-]*forma\b/i, intent: "projections" },
  {
    re: /\blender[\s-]*ready[\s-]*(?:package|bundle|deck|docs|documents)?\b/i,
    intent: "lender_ready_package",
  },
  { re: /\bpreview[\s-]*package\b/i, intent: "lender_ready_package" },
  {
    re: /\btrident[\s-]*(?:package|bundle|preview)?\b/i,
    intent: "lender_ready_package",
  },
];

/**
 * "what we/you/buddy built|made|created|generated|prepared|put together|did"
 * and the auxiliary form "what did you build / what will you make / what
 * have you put together" — borrower asking to see the deliverable Buddy
 * already produced.
 */
const BUILT_PHRASE = new RegExp(
  [
    // past form: "what we/you built"
    String.raw`\bwhat\s+(?:we|you|buddy|i|they)\s+(?:built|made|created|generated|prepared|put\s+together|did|have\s+(?:built|made|prepared|generated))\b`,
    // auxiliary form: "what did you build", "what will you make", "what have you put together"
    String.raw`\bwhat\s+(?:did|do|does|will|have|has|are|is)\s+(?:we|you|buddy|i|they)\s+(?:build|built|make|made|create|created|generate|generated|prepare|prepared|put|building|making|creating|generating|preparing)\b`,
  ].join("|"),
  "i",
);

/**
 * Soft deliverable nouns — "the plan", "my package", "our documents", etc.
 * These do NOT trigger on their own (too ambiguous: "I have the documents"
 * means the borrower is uploading, not asking). They trigger only when a
 * REQUEST_CUE also appears in the same message.
 */
const SOFT_NOUN_PATTERN =
  /\b(?:the|my|our|a|your)\s+(?:plan|package|deliverables?|docs?|documents?|files?|bundle|trident|preview|materials?|deck|output|writeup|write[\s-]*up|paperwork)\b/i;

/**
 * Verbs / phrases that indicate the borrower is asking to receive or view
 * something. Pairs with SOFT_NOUN_PATTERN to disambiguate from "I have the
 * documents" (no request cue → no trigger).
 */
const REQUEST_CUE_PATTERN =
  /\b(?:show|see|view|preview|give|send|share|hand|fetch|grab|get|read|open|find|download|generate|build|create|make|prepare|where|what|how|can\s+(?:i|we|you)|could\s+(?:i|we|you)|may\s+i|would\s+(?:i|we|you|like)|please|let\s+me\s+see|look\s+(?:at)?|check\s+out|i\s+(?:want|need|would\s+like)|i'?d\s+like|ready\s+to\s+see)\b/i;

export function detectTridentIntent(text: string): TridentIntentResult {
  if (!text || typeof text !== "string") return { matched: false };

  for (const { re, intent } of STRONG_NOUN_PATTERNS) {
    const m = text.match(re);
    if (m) return { matched: true, intent, matchedTerm: m[0] };
  }

  const builtMatch = text.match(BUILT_PHRASE);
  if (builtMatch) {
    return {
      matched: true,
      intent: "lender_ready_package",
      matchedTerm: builtMatch[0],
    };
  }

  const softMatch = text.match(SOFT_NOUN_PATTERN);
  if (softMatch && REQUEST_CUE_PATTERN.test(text)) {
    return {
      matched: true,
      intent: "lender_ready_package",
      matchedTerm: softMatch[0],
    };
  }

  return { matched: false };
}
