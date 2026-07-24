import "server-only";

/**
 * Canonical brokerage deal-stage machine — SPEC-BROKERAGE-OPERATING-SYSTEM-V1
 * PR3 §5.1-5.2.
 *
 * Additive layer on top of `deals` — deliberately independent of
 * deals.stage / deal_status.stage / src/buddy/lifecycle's LifecycleStage,
 * which remain authoritative for internal document/underwriting readiness.
 * This models a different fact: where the deal sits in the brokerage's
 * relationship/sales process. See the migration header comment for the
 * full discovery rationale.
 */

export const BROKERAGE_STAGES = [
  "intake",
  "discovery",
  "qualification",
  "engagement",
  "application",
  "document_collection",
  "financial_analysis",
  "packaging",
  "lender_strategy",
  "submitted",
  "lender_review",
  "term_sheet",
  "underwriting",
  "commitment",
  "closing",
  "funded",
  "post_close",
  "on_hold",
  "withdrawn",
  "declined",
  "lost",
] as const;

export type BrokerageStage = (typeof BROKERAGE_STAGES)[number];

export const TERMINAL_STAGES: ReadonlySet<BrokerageStage> = new Set([
  "post_close",
  "withdrawn",
  "declined",
  "lost",
]);

export function isTerminalStage(stage: BrokerageStage): boolean {
  return TERMINAL_STAGES.has(stage);
}

export function isValidBrokerageStage(value: string): value is BrokerageStage {
  return (BROKERAGE_STAGES as readonly string[]).includes(value);
}

const ACTIVE_STAGES: readonly BrokerageStage[] = BROKERAGE_STAGES.filter(
  (s) => !TERMINAL_STAGES.has(s) && s !== "on_hold",
);

// "on_hold" is a special pause state reachable from (and returning to) any
// active stage — staff decide where to resume rather than the machine
// tracking an implicit "stage before hold."
export const ALLOWED_TRANSITIONS: Record<BrokerageStage, readonly BrokerageStage[]> = {
  intake: ["discovery", "withdrawn", "declined"],
  discovery: ["qualification", "on_hold", "withdrawn", "declined"],
  qualification: ["engagement", "on_hold", "withdrawn", "declined", "lost"],
  engagement: ["application", "on_hold", "withdrawn", "lost"],
  application: ["document_collection", "on_hold", "withdrawn", "lost"],
  document_collection: ["financial_analysis", "on_hold", "withdrawn", "lost"],
  financial_analysis: ["packaging", "on_hold", "withdrawn", "lost"],
  packaging: ["lender_strategy", "on_hold", "withdrawn", "lost"],
  lender_strategy: ["submitted", "on_hold", "withdrawn", "lost"],
  submitted: ["lender_review", "on_hold", "declined", "lost"],
  lender_review: ["term_sheet", "submitted", "on_hold", "declined", "lost"],
  term_sheet: ["underwriting", "on_hold", "declined", "lost"],
  underwriting: ["commitment", "on_hold", "declined", "lost"],
  commitment: ["closing", "on_hold", "lost"],
  closing: ["funded", "on_hold", "lost"],
  funded: ["post_close"],
  post_close: [],
  on_hold: [...ACTIVE_STAGES],
  withdrawn: [],
  declined: [],
  lost: [],
};

export function canTransition(from: BrokerageStage, to: BrokerageStage): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Whole days since the deal entered its current stage. */
export function stageAgeDays(stageEnteredAt: string, now: Date = new Date()): number {
  return Math.floor((now.getTime() - new Date(stageEnteredAt).getTime()) / (24 * 3600 * 1000));
}
