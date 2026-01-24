/**
 * Lifecycle Event Types
 *
 * Maps to existing deal_events.kind values where possible.
 * New event types follow the same naming convention.
 *
 * These are emitted via the existing writeEvent() function from src/lib/ledger/writeEvent.ts
 */

export const LedgerEventType = {
  // Deal creation and initialization
  deal_created: "deal.created",
  deal_ignited: "deal.ignited",

  // Checklist events
  checklist_seeded: "deal.checklist.seeded",
  checklist_updated: "deal.checklist.updated",
  checklist_satisfied: "deal.checklist.satisfied",

  // Document events (maps to existing)
  docs_requested: "deal.docs.requested",
  doc_uploaded: "upload.received", // existing event kind
  doc_classified: "classification.complete", // existing event kind

  // Lifecycle advancement
  lifecycle_advanced: "deal.lifecycle.advanced",

  // Underwriting events
  underwrite_started: "deal.underwrite.started",
  underwrite_completed: "deal.underwrite.completed",

  // Financial snapshot
  financial_snapshot_created: "deal.financial_snapshot.created",

  // Policy exceptions
  policy_exception_created: "deal.policy_exception.created",
  policy_exception_resolved: "deal.policy_exception.resolved",

  // Committee events
  committee_packet_generated: "deal.committee.packet.generated",
  committee_required_evaluated: "deal.committee.required.evaluated",

  // Decision events
  decision_snapshot_created: "decision_snapshot_created", // existing event kind
  decision_finalized: "deal.decision.finalized",

  // Attestation events
  attestation_added: "decision.attested", // existing event kind

  // Closing events
  closing_started: "deal.closing.started",
  closed: "deal.closed",

  // Workout
  workout_entered: "deal.workout.entered",
} as const;

export type LedgerEventTypeValue = (typeof LedgerEventType)[keyof typeof LedgerEventType];

/**
 * Payload types for lifecycle events.
 * These extend the existing deal_events.payload schema.
 */
export type LifecycleAdvancedPayload = {
  from: string;
  to: string;
  actor: {
    type: string;
    id: string;
  };
  reason?: string;
};

export type ChecklistUpdatedPayload = {
  checklistKey: string;
  status: string;
  previousStatus?: string;
  satisfiedBy?: string; // document id
};

export type BlockerResolvedPayload = {
  blockerCode: string;
  resolvedBy?: string;
  evidence?: Record<string, unknown>;
};
