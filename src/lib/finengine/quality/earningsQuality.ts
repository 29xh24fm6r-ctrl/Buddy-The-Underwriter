/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 4: Earnings Quality Engine.
 *
 * Moves beyond EBITDA math into recurring-earnings intelligence: given a
 * reported EBITDA and a set of proposed adjustments, it computes (a) recurring
 * EBITDA (one-time effects stripped out) and (b) a quality-adjusted EBITDA that
 * credits only SUPPORTED, non-aggressive normalizations — plus concerns and a
 * confidence score.
 *
 * SAFETY: the reported EBITDA is returned verbatim and NEVER mutated. The
 * quality-adjusted figure is a separate field a caller opts into. Pure, no IO.
 */

import {
  evaluateAdjustment,
  type ProposedAdjustment,
  type EvaluatedAdjustment,
} from "@/lib/finengine/quality/earningsAdjustments";

export type EarningsQualityInput = {
  /** Reported / as-filed EBITDA. Returned unchanged. */
  reportedEbitda: number;
  adjustments: ProposedAdjustment[];
};

export type EarningsQuality = {
  reportedEbitda: number;
  /** Reported minus one-time income, plus one-time losses added back. */
  recurringEbitda: number;
  /**
   * Quality-adjusted EBITDA: recurring EBITDA + supported, non-aggressive
   * standing normalizations (owner comp, related-party rent). Only differs from
   * `reportedEbitda` when a caller reads this field — the reported value is never
   * changed in place.
   */
  qualityAdjustedEbitda: number;
  evaluated: EvaluatedAdjustment[];
  concerns: string[];
  /** Fraction of adjustment dollars that are supported + non-aggressive, [0,1]. */
  confidence: number;
};

const signed = (a: EvaluatedAdjustment) => (a.direction === "ADD" ? a.amount : -a.amount);

export function assessEarningsQuality(input: EarningsQualityInput): EarningsQuality {
  const evaluated = input.adjustments.map((a) => evaluateAdjustment(a, input.reportedEbitda));
  const concerns: string[] = [];

  // Recurring EBITDA: remove NONRECURRING items' effect on reported earnings.
  //   - a nonrecurring GAIN inflated earnings → subtract it out
  //   - a nonrecurring LOSS depressed earnings → add it back
  let recurringEbitda = input.reportedEbitda;
  for (const a of evaluated) {
    if (a.recurrence !== "NONRECURRING") continue;
    // Reverse the one-time item's effect on reported earnings.
    if (a.direction === "SUBTRACT") recurringEbitda -= a.amount; // strip inflating gain
    else recurringEbitda += a.amount; // add back one-time loss
  }

  // Quality-adjusted EBITDA starts from recurring and credits ONLY supported,
  // non-aggressive standing normalizations (recurring, add-direction).
  let qualityAdjustedEbitda = recurringEbitda;
  for (const a of evaluated) {
    if (a.recurrence !== "RECURRING") continue;
    if (a.direction !== "ADD") continue;
    if (!a.supported || a.aggressive) {
      concerns.push(`excluded_${a.category.toLowerCase()}:${a.reasons.join("|") || "unsupported"}`);
      continue;
    }
    qualityAdjustedEbitda += a.amount;
  }

  for (const a of evaluated) {
    if (a.aggressive) concerns.push(`aggressive_addback:${a.label}`);
  }

  // Confidence = supported-and-clean dollars / total adjustment dollars.
  const totalDollars = evaluated.reduce((s, a) => s + a.amount, 0);
  const cleanDollars = evaluated
    .filter((a) => a.supported && !a.aggressive)
    .reduce((s, a) => s + a.amount, 0);
  const confidence = totalDollars > 0 ? cleanDollars / totalDollars : 1;

  return {
    reportedEbitda: input.reportedEbitda,
    recurringEbitda,
    qualityAdjustedEbitda,
    evaluated,
    concerns: [...new Set(concerns)],
    confidence,
  };
}

/** Convenience alias kept explicit so callers signal the opt-in quality mode. */
export function qualityAdjustedEbitda(input: EarningsQualityInput): number {
  return assessEarningsQuality(input).qualityAdjustedEbitda;
}
