/**
 * Repair Decision Engine — Phase 2.4 (Pure)
 *
 * Determines the correct binding action for an entity-scoped slot.
 * Zero database calls. Deterministic. Exported for CI guard import.
 *
 * Decision table:
 *   required_entity_id IS NOT NULL   → SKIP_ALREADY_BOUND
 *   doc_type not in mapping           → SKIP_ALREADY_BOUND (unknown, not our concern)
 *   matching entities = 1             → BIND_EXISTING
 *   matching entities = 0             → CREATE_SYNTHETIC_AND_BIND
 *   matching entities > 1             → REQUIRES_REVIEW
 */

export type RepairDecision = {
  action:
    | "BIND_EXISTING"
    | "CREATE_SYNTHETIC_AND_BIND"
    | "REQUIRES_REVIEW"
    | "SKIP_ALREADY_BOUND";
  /** Primary entity kind — populated for CREATE_SYNTHETIC_AND_BIND only */
  entityKind?: string;
  reason: string;
};

export type SlotInput = {
  required_doc_type: string;
  required_entity_id: string | null;
};

export type EntityInput = {
  id: string;
  entity_kind: string;
  synthetic: boolean;
};

/**
 * Authoritative mapping: doc_type → acceptable entity_kind values.
 * Exported as single source of truth — used by orchestration engine and CI guards.
 */
export const ENTITY_KIND_FOR_DOC_TYPE: Record<string, string[]> = {
  PERSONAL_TAX_RETURN: ["PERSON"],
  PERSONAL_FINANCIAL_STATEMENT: ["PERSON"],
  BUSINESS_TAX_RETURN: ["OPCO", "PROPCO", "HOLDCO"],
};

export function computeRepairDecision(
  slot: SlotInput,
  entities: EntityInput[],
): RepairDecision {
  // Already bound — idempotency skip
  if (slot.required_entity_id != null) {
    return { action: "SKIP_ALREADY_BOUND", reason: "already_bound" };
  }

  const allowedKinds = ENTITY_KIND_FOR_DOC_TYPE[slot.required_doc_type];
  if (!allowedKinds) {
    // Not an entity-scoped doc type — not our concern
    return { action: "SKIP_ALREADY_BOUND", reason: "unknown_doc_type" };
  }

  const matching = entities.filter((e) => allowedKinds.includes(e.entity_kind));

  if (matching.length === 1) {
    return { action: "BIND_EXISTING", reason: "single_entity_match" };
  }

  if (matching.length === 0) {
    return {
      action: "CREATE_SYNTHETIC_AND_BIND",
      entityKind: allowedKinds[0],
      reason: "zero_entities",
    };
  }

  // Multiple candidates → banker must resolve
  return { action: "REQUIRES_REVIEW", reason: "multiple_entities" };
}
