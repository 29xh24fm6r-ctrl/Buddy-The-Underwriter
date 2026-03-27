/**
 * Canonical Decision Model — Phase 63
 *
 * Shared primitives for all decision actions across surfaces.
 * Every write action in Buddy flows through this model.
 */

export type DecisionActor = {
  userId: string;
  bankId: string;
  role: string;
  displayName?: string;
};

export type DecisionContext = {
  dealId: string;
  bankId: string;
  sourceSurface: string;
  entityType: "deal" | "exception" | "pricing" | "checklist_item";
  entityId?: string;
};

export type DecisionResult<T = unknown> = {
  ok: boolean;
  error?: string;
  reason?: string;
  updatedState?: T;
  ledgerEventId?: string;
  transition?: {
    from: string;
    to: string;
  };
};

/** Standard error codes for decision API responses */
export type DecisionErrorCode =
  | "forbidden"
  | "not_found"
  | "invalid_state"
  | "validation_failed"
  | "tenant_mismatch"
  | "duplicate_submission";

/** Ledger event fields required for every action */
export type DecisionLedgerPayload = {
  deal_id: string;
  bank_id: string;
  actor_user_id: string;
  actor_role: string;
  surface_key: string;
  entity_type: string;
  entity_id?: string;
  action_key: string;
  prior_state?: string;
  next_state?: string;
  rationale?: string;
};

/** Committee decision actions */
export type CommitteeAction = "approve" | "decline" | "escalate";

/** Exception decision actions */
export type ExceptionAction = "approve" | "reject" | "escalate";

/** Pricing commit actions */
export type PricingAction = "commit" | "lock" | "publish";

/** Checklist resolution actions */
export type ChecklistAction = "submit" | "accept" | "clarify" | "return";
