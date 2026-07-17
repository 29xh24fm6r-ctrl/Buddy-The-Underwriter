import "server-only";

/**
 * Lead stage machine — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR2 §4.1.
 *
 * A deterministic transition matrix rather than a free-text status field:
 * every move is either allowed or rejected before it hits the database, and
 * the allowed set is exhaustively testable outside the UI. `converted` is
 * reachable only through convertLeadToDeal() (see convert.ts), never through
 * a generic stage-set call, so the deal-linkage invariants there can't be
 * bypassed by a stray PATCH.
 */

export const LEAD_STAGES = [
  "new",
  "attempting_contact",
  "contacted",
  "discovery_scheduled",
  "discovery_complete",
  "information_requested",
  "preliminary_qualification",
  "qualified",
  "engagement_pending",
  "engagement_accepted",
  "application_started",
  "converted",
  "nurture",
  "unresponsive",
  "disqualified",
  "withdrawn",
  "lost",
] as const;

export type LeadStage = (typeof LEAD_STAGES)[number];

// Stages a lead can never leave once entered — either it became a deal
// (converted) or the outcome is final (disqualified/withdrawn/lost). Staff
// wanting to reopen one of these creates a new lead rather than reanimating
// a closed record, so the audit trail on the closed lead stays honest.
export const TERMINAL_STAGES: ReadonlySet<LeadStage> = new Set([
  "converted",
  "disqualified",
  "withdrawn",
  "lost",
]);

export function isTerminalStage(stage: LeadStage): boolean {
  return TERMINAL_STAGES.has(stage);
}

// `converted` is deliberately absent from every "to" list below — it is
// only ever set by convertLeadToDeal(), which writes it directly.
export const ALLOWED_TRANSITIONS: Record<LeadStage, readonly LeadStage[]> = {
  new: ["attempting_contact", "disqualified", "withdrawn"],
  attempting_contact: ["contacted", "unresponsive", "disqualified", "withdrawn"],
  contacted: ["discovery_scheduled", "information_requested", "nurture", "unresponsive", "disqualified", "withdrawn"],
  discovery_scheduled: ["discovery_complete", "contacted", "disqualified", "withdrawn"],
  discovery_complete: ["information_requested", "preliminary_qualification", "disqualified", "withdrawn"],
  information_requested: ["preliminary_qualification", "nurture", "disqualified", "withdrawn"],
  preliminary_qualification: ["qualified", "nurture", "disqualified", "withdrawn"],
  qualified: ["engagement_pending", "nurture", "disqualified", "withdrawn"],
  engagement_pending: ["engagement_accepted", "nurture", "lost", "withdrawn"],
  engagement_accepted: ["application_started", "lost", "withdrawn"],
  application_started: ["lost", "withdrawn"],
  nurture: ["attempting_contact", "contacted", "disqualified", "withdrawn", "lost"],
  unresponsive: ["attempting_contact", "disqualified", "withdrawn", "lost"],
  converted: [],
  disqualified: [],
  withdrawn: [],
  lost: [],
};

export function canTransition(from: LeadStage, to: LeadStage): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isValidLeadStage(value: string): value is LeadStage {
  return (LEAD_STAGES as readonly string[]).includes(value);
}
