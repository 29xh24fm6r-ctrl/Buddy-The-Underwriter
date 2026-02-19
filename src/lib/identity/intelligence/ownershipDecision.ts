/**
 * Ownership Inference Decision Engine — Phase 2.5 (Pure)
 *
 * Determines whether ownership relationships can be deterministically inferred
 * between entities in a deal. Zero DB calls. Deterministic.
 *
 * Inference rules:
 *   Rule 1: 1 PERSON + 1 OPCO + SBA product → INFER_OWNER_OF 100%
 *   Rule 2: Multiple PERSONs → NO_INFERENCE (multi_person_ambiguous)
 *   Rule 3: No persons → NO_INFERENCE (insufficient_signals)
 *   All other cases → NO_INFERENCE
 *
 * Idempotency: caller checks existingRelationships before inferring.
 */

export type OwnershipDecision = {
  action: "INFER_OWNER_OF" | "NO_INFERENCE";
  parentEntityId?: string;
  childEntityId?: string;
  ownershipPct?: number;
  reason: string;
};

export function computeOwnershipDecision(
  entities: Array<{ id: string; entity_kind: string; synthetic: boolean }>,
  productType: string | null,
  existingRelationships: Array<{
    parent_entity_id: string;
    child_entity_id: string;
  }>,
): OwnershipDecision[] {
  const persons = entities.filter((e) => e.entity_kind === "PERSON");
  const businesses = entities.filter((e) =>
    ["OPCO", "PROPCO", "HOLDCO"].includes(e.entity_kind),
  );

  // Rule 1: Exactly one PERSON + exactly one OPCO + SBA product → infer OWNER_OF 100%
  if (
    persons.length === 1 &&
    businesses.length === 1 &&
    (productType === "SBA_7A" || productType === "SBA_504")
  ) {
    const pair = {
      parent_entity_id: persons[0].id,
      child_entity_id: businesses[0].id,
    };

    const alreadyExists = existingRelationships.some(
      (r) =>
        r.parent_entity_id === pair.parent_entity_id &&
        r.child_entity_id === pair.child_entity_id,
    );

    if (alreadyExists) {
      return [{ action: "NO_INFERENCE", reason: "already_inferred" }];
    }

    return [
      {
        action: "INFER_OWNER_OF",
        parentEntityId: persons[0].id,
        childEntityId: businesses[0].id,
        ownershipPct: 100,
        reason: "single_person_single_opco_sba",
      },
    ];
  }

  // Multiple persons → require explicit document confirmation
  if (persons.length > 1) {
    return [{ action: "NO_INFERENCE", reason: "multi_person_ambiguous" }];
  }

  return [{ action: "NO_INFERENCE", reason: "insufficient_signals" }];
}
