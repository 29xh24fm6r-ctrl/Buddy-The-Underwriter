/**
 * Omega URI builders.
 *
 * Pure string construction — no business logic, no IO, no side-effects.
 * All URIs follow the omega:// scheme defined in docs/omega/mapping.json.
 */

// ---------------------------------------------------------------------------
// Entity URIs
// ---------------------------------------------------------------------------

const ENTITY_PREFIX = "omega://entity";

export type OmegaEntityType =
  | "deal"
  | "borrower"
  | "borrower_owner"
  | "document"
  | "underwriting_case"
  | "financial_snapshot"
  | "credit_decision"
  | "policy_context"
  | "examiner_drop";

/**
 * Build an entity URI.
 *
 * Single-id entities:  omegaEntityUri("deal", dealId)
 * Composite-id:        omegaEntityUri("policy_context", bankId, policyVersion)
 *                      omegaEntityUri("examiner_drop", dealId, snapshotId)
 */
export function omegaEntityUri(
  entityType: OmegaEntityType,
  ...ids: string[]
): string {
  if (ids.length === 0) {
    throw new Error(`omegaEntityUri requires at least one id for ${entityType}`);
  }
  return `${ENTITY_PREFIX}/${entityType}/${ids.join("/")}`;
}

// ---------------------------------------------------------------------------
// State URIs
// ---------------------------------------------------------------------------

const STATE_PREFIX = "omega://state";

export type OmegaStateType =
  | "underwriting_case"
  | "borrower"
  | "credit_decision"
  | "examiner_drop"
  | "policy_context";

export function omegaStateUri(stateType: OmegaStateType, id: string): string {
  return `${STATE_PREFIX}/${stateType}/${id}`;
}

// ---------------------------------------------------------------------------
// Constraints URIs
// ---------------------------------------------------------------------------

const CONSTRAINTS_PREFIX = "omega://constraints";

export type OmegaConstraintNamespace =
  | "buddy/underwriting"
  | "buddy/model_governance";

export function omegaConstraintsUri(
  namespace: OmegaConstraintNamespace,
): string {
  return `${CONSTRAINTS_PREFIX}/${namespace}`;
}

// ---------------------------------------------------------------------------
// Traces URIs
// ---------------------------------------------------------------------------

const TRACES_PREFIX = "omega://traces";

export function omegaTracesUri(sessionId: string): string {
  return `${TRACES_PREFIX}/${sessionId}`;
}

// ---------------------------------------------------------------------------
// Events write resource (constant)
// ---------------------------------------------------------------------------

export const OMEGA_EVENTS_WRITE_RESOURCE = "omega://events/write" as const;
