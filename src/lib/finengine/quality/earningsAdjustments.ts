/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 4: Earnings Quality Engine.
 *
 * Models a single proposed earnings adjustment (add-back or removal) and judges
 * whether it is supported and whether it is aggressive. Pure + deterministic.
 * Owns NO connection to the live adjustedEbitda method — it evaluates proposed
 * items in a shadow, quality-scoring capacity only.
 */

import {
  classifyAdjustment,
  type AdjustmentCategory,
  type RecurrenceClass,
} from "@/lib/finengine/quality/recurringIncomeClassifier";

export type ProposedAdjustment = {
  label: string;
  /** Magnitude (always positive); `direction` carries the sign intent. */
  amount: number;
  /** ADD = add back to earnings, SUBTRACT = remove from earnings. */
  direction: "ADD" | "SUBTRACT";
  /** A reference to supporting evidence (doc id, note). Absent ⇒ unsupported. */
  support?: string | null;
};

export type EvaluatedAdjustment = {
  label: string;
  amount: number;
  direction: "ADD" | "SUBTRACT";
  category: AdjustmentCategory;
  recurrence: RecurrenceClass;
  supported: boolean;
  aggressive: boolean;
  reasons: string[];
};

/**
 * Categories where an ADD-BACK is inherently suspect (adding these back inflates
 * earnings with items a conservative underwriter would not credit without proof).
 */
const SUSPECT_ADDBACK_CATEGORIES: ReadonlySet<AdjustmentCategory> = new Set([
  "OTHER",
]);

/**
 * Evaluate one proposed adjustment.
 *
 * @param base  the reported EBITDA the add-back is measured against (for
 *              size-based aggressiveness); pass 0 to disable the size test.
 */
export function evaluateAdjustment(adj: ProposedAdjustment, base = 0): EvaluatedAdjustment {
  const cls = classifyAdjustment(adj.label);
  const supported = !!adj.support && adj.support.trim().length > 0;
  const reasons: string[] = [];

  let aggressive = false;

  // 1. Unsupported add-backs are aggressive (you cannot credit unproven income).
  if (adj.direction === "ADD" && !supported) {
    aggressive = true;
    reasons.push("unsupported_addback");
  }

  // 2. Adding back an uncategorized ("OTHER") item is aggressive on its face.
  if (adj.direction === "ADD" && SUSPECT_ADDBACK_CATEGORIES.has(cls.category)) {
    aggressive = true;
    reasons.push("uncategorized_addback");
  }

  // 3. Size test — an add-back exceeding 25% of base earnings is aggressive
  //    unless independently supported.
  if (adj.direction === "ADD" && base > 0 && adj.amount > 0.25 * base && !supported) {
    aggressive = true;
    reasons.push("oversized_addback");
  }

  // 4. Adding back a nonrecurring LOSS is legitimate; adding back a recurring
  //    operating item that is not a standard EBITDA add-back is suspect.
  if (
    adj.direction === "ADD" &&
    cls.recurrence === "RECURRING" &&
    !["OWNER_COMP_NORMALIZATION", "RELATED_PARTY_RENT", "DEPRECIATION", "AMORTIZATION", "INTEREST"].includes(cls.category)
  ) {
    aggressive = true;
    reasons.push("recurring_item_added_back");
  }

  return {
    label: adj.label,
    amount: adj.amount,
    direction: adj.direction,
    category: cls.category,
    recurrence: cls.recurrence,
    supported,
    aggressive,
    reasons,
  };
}

/**
 * Owner-compensation normalization: the excess over reasonable market comp is the
 * defensible add-back. Never negative. Pure.
 */
export function normalizeOwnerComp(args: {
  reportedOwnerComp: number;
  reasonableMarketComp: number;
}): { excessAddBack: number; concern: string | null } {
  const excess = Math.max(0, args.reportedOwnerComp - args.reasonableMarketComp);
  const concern =
    args.reasonableMarketComp <= 0 ? "no_market_comp_benchmark_provided" : null;
  return { excessAddBack: excess, concern };
}
