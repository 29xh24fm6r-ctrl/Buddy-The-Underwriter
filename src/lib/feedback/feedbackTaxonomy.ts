/**
 * Feedback Taxonomy — Phase 66C, System 5 (pure)
 *
 * Defines structured feedback categories and the mapping from
 * granular feedback types to higher-level categories.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type FeedbackType =
  | "helpful"
  | "unhelpful"
  | "confusing"
  | "irrelevant"
  | "too_early"
  | "too_late"
  | "unrealistic"
  | "misleading"
  | "override_reason"
  | "suggestion";

export type FeedbackCategory =
  | "quality"
  | "timing"
  | "relevance"
  | "clarity"
  | "accuracy"
  | "actionability";

/* ------------------------------------------------------------------ */
/*  Taxonomy constant                                                  */
/* ------------------------------------------------------------------ */

export const FEEDBACK_TAXONOMY: Record<
  FeedbackType,
  { category: FeedbackCategory; description: string }
> = {
  helpful: { category: "quality", description: "The recommendation was useful and on-target" },
  unhelpful: { category: "quality", description: "The recommendation provided no value" },
  confusing: { category: "clarity", description: "The recommendation was hard to understand" },
  irrelevant: { category: "relevance", description: "The recommendation did not apply to this deal" },
  too_early: { category: "timing", description: "The recommendation surfaced before it was actionable" },
  too_late: { category: "timing", description: "The recommendation arrived after the decision was made" },
  unrealistic: { category: "accuracy", description: "The recommendation assumed conditions that do not hold" },
  misleading: { category: "accuracy", description: "The recommendation could lead to incorrect conclusions" },
  override_reason: { category: "actionability", description: "Explanation for why the banker overrode a recommendation" },
  suggestion: { category: "actionability", description: "A constructive suggestion for improving recommendations" },
} as const;

/* ------------------------------------------------------------------ */
/*  classifyFeedback                                                   */
/* ------------------------------------------------------------------ */

export function classifyFeedback(feedbackType: FeedbackType): FeedbackCategory {
  return FEEDBACK_TAXONOMY[feedbackType].category;
}
