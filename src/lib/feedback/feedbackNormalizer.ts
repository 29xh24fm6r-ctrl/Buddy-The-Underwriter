/**
 * Feedback Normalizer — Phase 66C, System 5 (pure)
 *
 * Normalizes free-text feedback into structured form with sentiment,
 * keywords, and actionability classification.
 */

import type { FeedbackType, FeedbackCategory } from "./feedbackTaxonomy";
import { classifyFeedback } from "./feedbackTaxonomy";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type NormalizedFeedback = {
  category: FeedbackCategory;
  sentiment: "positive" | "negative" | "neutral";
  keywords: string[];
  actionable: boolean;
  summary: string;
};

/* ------------------------------------------------------------------ */
/*  Stop words (common English, lowercase)                             */
/* ------------------------------------------------------------------ */

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "through", "during",
  "before", "after", "above", "below", "between", "and", "but", "or",
  "nor", "not", "so", "yet", "both", "either", "neither", "each",
  "every", "all", "any", "few", "more", "most", "other", "some", "such",
  "no", "only", "own", "same", "than", "too", "very", "just", "because",
  "if", "when", "where", "how", "what", "which", "who", "whom", "this",
  "that", "these", "those", "i", "me", "my", "we", "our", "you", "your",
  "he", "him", "his", "she", "her", "it", "its", "they", "them", "their",
]);

/* ------------------------------------------------------------------ */
/*  Sentiment mapping                                                  */
/* ------------------------------------------------------------------ */

const POSITIVE_TYPES: ReadonlySet<FeedbackType> = new Set(["helpful", "suggestion"]);
const NEGATIVE_TYPES: ReadonlySet<FeedbackType> = new Set([
  "unhelpful", "confusing", "misleading",
]);

function deriveSentiment(feedbackType: FeedbackType): "positive" | "negative" | "neutral" {
  if (POSITIVE_TYPES.has(feedbackType)) return "positive";
  if (NEGATIVE_TYPES.has(feedbackType)) return "negative";
  return "neutral";
}

/* ------------------------------------------------------------------ */
/*  Keyword extraction                                                 */
/* ------------------------------------------------------------------ */

function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  /* Deduplicate, sort by length descending, take top 5 */
  const unique = [...new Set(words)];
  unique.sort((a, b) => b.length - a.length);
  return unique.slice(0, 5);
}

/* ------------------------------------------------------------------ */
/*  normalizeFeedback                                                  */
/* ------------------------------------------------------------------ */

export function normalizeFeedback(
  text: string,
  feedbackType: FeedbackType,
): NormalizedFeedback {
  const category = classifyFeedback(feedbackType);
  const sentiment = deriveSentiment(feedbackType);
  const keywords = extractKeywords(text);
  const actionable = feedbackType === "suggestion" || feedbackType === "override_reason";
  const summary =
    text.length > 120 ? text.slice(0, 117) + "..." : text;

  return { category, sentiment, keywords, actionable, summary };
}
