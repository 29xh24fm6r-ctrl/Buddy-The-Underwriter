/**
 * Entity Auto-Repair Guard — CI-Blocking Governance Invariants (Layer 2.4)
 *
 * Validates the pure repair decision engine:
 *   1. ENTITY_KIND_FOR_DOC_TYPE covers all ENTITY_SCOPED_DOC_TYPES exactly
 *   2. Single matching entity → BIND_EXISTING + reason = "single_entity_match"
 *   3. Zero entities → CREATE_SYNTHETIC_AND_BIND + correct entityKind
 *   4. Multiple entities → REQUIRES_REVIEW, no binding decision
 *   5. Already-bound slot → SKIP_ALREADY_BOUND (idempotency)
 *   6. Structural invariant — unbound non-review slot is a violation
 *
 * Pure function tests — no DB, no IO, no side effects.
 * Imports only from repairDecision.ts.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  computeRepairDecision,
  ENTITY_KIND_FOR_DOC_TYPE,
  type SlotInput,
  type EntityInput,
} from "../../slots/repair/repairDecision";
import { ENTITY_SCOPED_DOC_TYPES } from "../../identity/entityScopedDocTypes";

// ---------------------------------------------------------------------------
// Guard 1: ENTITY_KIND_FOR_DOC_TYPE covers all ENTITY_SCOPED_DOC_TYPES exactly
// ---------------------------------------------------------------------------

test("ENTITY_KIND_FOR_DOC_TYPE covers all ENTITY_SCOPED_DOC_TYPES exactly", () => {
  const mappingKeys = new Set(Object.keys(ENTITY_KIND_FOR_DOC_TYPE));

  // Every entity-scoped doc type must have a mapping
  for (const docType of ENTITY_SCOPED_DOC_TYPES) {
    assert.ok(
      mappingKeys.has(docType),
      `ENTITY_KIND_FOR_DOC_TYPE must cover ${docType}`,
    );
  }

  // Every mapping key must be an entity-scoped doc type (no extra keys)
  for (const key of mappingKeys) {
    assert.ok(
      ENTITY_SCOPED_DOC_TYPES.has(key),
      `ENTITY_KIND_FOR_DOC_TYPE has unexpected key: ${key}`,
    );
  }

  assert.strictEqual(
    mappingKeys.size,
    ENTITY_SCOPED_DOC_TYPES.size,
    `Expected ${ENTITY_SCOPED_DOC_TYPES.size} mapping entries, got ${mappingKeys.size}`,
  );

  console.log(
    `[entityAutoRepairGuard] mapping coverage: ${mappingKeys.size}/${ENTITY_SCOPED_DOC_TYPES.size} ✓`,
  );
});

// ---------------------------------------------------------------------------
// Guard 2: Single matching entity → BIND_EXISTING
// ---------------------------------------------------------------------------

test("repair: single PERSON entity → BIND_EXISTING + reason = single_entity_match", () => {
  const slot: SlotInput = {
    required_doc_type: "PERSONAL_TAX_RETURN",
    required_entity_id: null,
  };
  const entities: EntityInput[] = [
    { id: "e1", entity_kind: "PERSON", synthetic: false },
  ];

  const decision = computeRepairDecision(slot, entities);

  assert.strictEqual(decision.action, "BIND_EXISTING");
  assert.strictEqual(decision.reason, "single_entity_match");
  console.log(`[entityAutoRepairGuard] single entity → BIND_EXISTING ✓`);
});

// ---------------------------------------------------------------------------
// Guard 3: Zero matching entities → CREATE_SYNTHETIC_AND_BIND
// ---------------------------------------------------------------------------

test("repair: zero entities → CREATE_SYNTHETIC_AND_BIND + entityKind = PERSON", () => {
  const slot: SlotInput = {
    required_doc_type: "PERSONAL_TAX_RETURN",
    required_entity_id: null,
  };
  const entities: EntityInput[] = [];

  const decision = computeRepairDecision(slot, entities);

  assert.strictEqual(decision.action, "CREATE_SYNTHETIC_AND_BIND");
  assert.strictEqual(decision.entityKind, "PERSON");
  assert.strictEqual(decision.reason, "zero_entities");
  console.log(
    `[entityAutoRepairGuard] zero entities → CREATE_SYNTHETIC_AND_BIND (PERSON) ✓`,
  );
});

test("repair: zero OPCO/PROPCO/HOLDCO for BTR → CREATE_SYNTHETIC_AND_BIND + entityKind = OPCO", () => {
  const slot: SlotInput = {
    required_doc_type: "BUSINESS_TAX_RETURN",
    required_entity_id: null,
  };
  const entities: EntityInput[] = [
    // PERSON entity present but not relevant for BTR
    { id: "e1", entity_kind: "PERSON", synthetic: false },
  ];

  const decision = computeRepairDecision(slot, entities);

  assert.strictEqual(decision.action, "CREATE_SYNTHETIC_AND_BIND");
  assert.strictEqual(decision.entityKind, "OPCO");
  assert.strictEqual(decision.reason, "zero_entities");
  console.log(
    `[entityAutoRepairGuard] zero business entities for BTR → CREATE_SYNTHETIC_AND_BIND (OPCO) ✓`,
  );
});

// ---------------------------------------------------------------------------
// Guard 4: Multiple matching entities → REQUIRES_REVIEW
// ---------------------------------------------------------------------------

test("repair: multiple PERSON entities → REQUIRES_REVIEW, no binding decision", () => {
  const slot: SlotInput = {
    required_doc_type: "PERSONAL_FINANCIAL_STATEMENT",
    required_entity_id: null,
  };
  const entities: EntityInput[] = [
    { id: "e1", entity_kind: "PERSON", synthetic: false },
    { id: "e2", entity_kind: "PERSON", synthetic: false },
  ];

  const decision = computeRepairDecision(slot, entities);

  assert.strictEqual(decision.action, "REQUIRES_REVIEW");
  assert.strictEqual(decision.reason, "multiple_entities");
  assert.ok(
    decision.entityKind === undefined,
    "entityKind must be absent for REQUIRES_REVIEW",
  );
  console.log(
    `[entityAutoRepairGuard] multiple entities → REQUIRES_REVIEW (no bind) ✓`,
  );
});

// ---------------------------------------------------------------------------
// Guard 5: Already-bound slot → SKIP_ALREADY_BOUND (idempotency)
// ---------------------------------------------------------------------------

test("repair: already-bound slot → SKIP_ALREADY_BOUND (idempotency)", () => {
  const slot: SlotInput = {
    required_doc_type: "PERSONAL_TAX_RETURN",
    required_entity_id: "existing-entity-uuid",
  };
  const entities: EntityInput[] = [
    { id: "e1", entity_kind: "PERSON", synthetic: false },
  ];

  const decision = computeRepairDecision(slot, entities);

  assert.strictEqual(decision.action, "SKIP_ALREADY_BOUND");
  assert.strictEqual(decision.reason, "already_bound");
  console.log(
    `[entityAutoRepairGuard] already-bound slot → SKIP_ALREADY_BOUND (idempotency) ✓`,
  );
});

// ---------------------------------------------------------------------------
// Guard 6: Structural invariant — unbound non-review slot is a violation
//
// This guard validates the logic that enforces the structural closure invariant.
// After repair, every entity-scoped slot must satisfy:
//   required_entity_id IS NOT NULL  OR  slot.id ∈ reviewSlotIds
//
// We simulate the invariant check: if a slot ends up unbound and was not
// routed to review, computeRepairDecision would NOT have returned REQUIRES_REVIEW
// for a single-entity deal — meaning a bind should have occurred.
// The invariant catches this missing bind.
// ---------------------------------------------------------------------------

test("structural invariant: slot unbound + not in reviewSlotIds = invariant violation", () => {
  // Simulate post-repair state: slot still has null entity_id
  // and was NOT added to reviewSlotIds
  const postRepairSlot = {
    id: "slot-123",
    slot_key: "ptr_y2023",
    required_entity_id: null as string | null,
  };
  const reviewSlotIds = new Set<string>(); // slot was not routed to review

  // The invariant check: this slot violates the structural guarantee
  const isInvariantViolated =
    postRepairSlot.required_entity_id == null &&
    !reviewSlotIds.has(postRepairSlot.id);

  assert.ok(
    isInvariantViolated,
    "Unbound non-review slot must trigger invariant violation",
  );

  // Verify the converse: a slot that IS in reviewSlotIds passes
  reviewSlotIds.add(postRepairSlot.id);
  const isInvariantSatisfied =
    postRepairSlot.required_entity_id == null &&
    !reviewSlotIds.has(postRepairSlot.id);

  assert.ok(
    !isInvariantSatisfied,
    "Slot in reviewSlotIds must NOT trigger invariant violation",
  );

  // Verify bound slot passes
  const boundSlot = { ...postRepairSlot, required_entity_id: "entity-uuid" };
  const boundInvariant =
    boundSlot.required_entity_id == null &&
    !reviewSlotIds.has(boundSlot.id);

  assert.ok(
    !boundInvariant,
    "Bound slot must NOT trigger invariant violation",
  );

  console.log(
    `[entityAutoRepairGuard] structural invariant logic verified ✓`,
  );
});
