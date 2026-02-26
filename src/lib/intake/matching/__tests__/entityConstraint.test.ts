/**
 * Entity Constraint — v1.4.0 Hard Enforcement Tests
 *
 * Tests the strict entity constraint behavior after soft-skip removal.
 * No bypass, no meta, no null relaxation.
 *
 * Verifies:
 *   1. Entity null + entity-required slot → satisfied=false (no soft-skip)
 *   2. Identity ambiguous → constraint fails
 *   3. Entity present: mismatch vs match enforcement
 *   4. Multi-entity: entity=null + entity slots → no auto_attach
 *   5. Role enforcement
 *   6. No meta field on constraint results
 */

import test from "node:test";
import assert from "node:assert/strict";
import { evaluateConstraints } from "../constraints";
import { matchDocumentToSlot } from "../matchEngine";
import type { DocumentIdentity, SlotSnapshot } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIdentity(overrides?: Partial<DocumentIdentity>): DocumentIdentity {
  return {
    documentId: "doc-1",
    effectiveDocType: "BUSINESS_TAX_RETURN",
    rawDocType: "IRS_BUSINESS",
    taxYear: 2024,
    entityType: "business",
    formNumbers: ["1120S"],
    authority: "deterministic",
    confidence: 0.97,
    classificationEvidence: [
      { type: "form_match", anchorId: "a1", matchedText: "1120S", confidence: 0.97 },
    ],
    period: null,
    entity: null,
    ...overrides,
  };
}

function makeSlot(overrides?: Partial<SlotSnapshot>): SlotSnapshot {
  return {
    slotId: "slot-1",
    slotKey: "BUSINESS_TAX_RETURN_2024",
    slotGroup: "tax_returns",
    requiredDocType: "BUSINESS_TAX_RETURN",
    requiredTaxYear: 2024,
    status: "empty",
    sortOrder: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TEST 1 — Entity Null → Hard Fail (no soft-skip)
// ---------------------------------------------------------------------------

test("Entity constraint: entity=null + slot has required_entity_id → satisfied=false (v1.4.0)", () => {
  const identity = makeIdentity({ entity: null });
  const slot = makeSlot({ requiredEntityId: "entity-abc-123" });

  const results = evaluateConstraints(identity, slot);

  const entityIdResult = results.find((r) => r.constraint === "entity_id_match");
  assert.ok(entityIdResult, "entity_id_match constraint must be present");
  assert.equal(entityIdResult.satisfied, false, "entity_id_match must FAIL when entity is null and slot requires entity");
});

test("Entity role constraint: entity=null + slot has required_entity_role → satisfied=false (v1.4.0)", () => {
  const identity = makeIdentity({ entity: null });
  const slot = makeSlot({ requiredEntityRole: "borrower" });

  const results = evaluateConstraints(identity, slot);

  const entityRoleResult = results.find((r) => r.constraint === "entity_role_match");
  assert.ok(entityRoleResult, "entity_role_match constraint must be present");
  assert.equal(entityRoleResult.satisfied, false, "entity_role_match must FAIL when entity is null and slot requires role");
});

test("Entity constraint: entity=null + slot has NO required_entity_id → satisfied=true", () => {
  const identity = makeIdentity({ entity: null });
  const slot = makeSlot({ requiredEntityId: null });

  const results = evaluateConstraints(identity, slot);

  const entityIdResult = results.find((r) => r.constraint === "entity_id_match");
  assert.ok(entityIdResult, "entity_id_match constraint must be present");
  assert.equal(entityIdResult.satisfied, true, "No entity requirement on slot → always satisfied");
});

// ---------------------------------------------------------------------------
// TEST 2 — Identity Ambiguity → Constraint Fail
// ---------------------------------------------------------------------------

test("Identity ambiguity: ambiguous=true → identity_not_ambiguous constraint fails", () => {
  const identity = makeIdentity({
    entity: {
      entityId: "entity-aaa",
      entityRole: "borrower",
      confidence: 0.55,
      ambiguous: true,
    },
  });
  const slot = makeSlot();

  const results = evaluateConstraints(identity, slot);

  const ambiguityResult = results.find((r) => r.constraint === "identity_not_ambiguous");
  assert.ok(ambiguityResult, "identity_not_ambiguous constraint must be present");
  assert.equal(ambiguityResult.satisfied, false, "ambiguous identity must fail constraint");
});

test("Identity ambiguity: ambiguous=false → identity_not_ambiguous constraint passes", () => {
  const identity = makeIdentity({
    entity: {
      entityId: "entity-aaa",
      entityRole: "borrower",
      confidence: 0.95,
      ambiguous: false,
    },
  });
  const slot = makeSlot();

  const results = evaluateConstraints(identity, slot);

  const ambiguityResult = results.find((r) => r.constraint === "identity_not_ambiguous");
  assert.ok(ambiguityResult, "identity_not_ambiguous constraint must be present");
  assert.equal(ambiguityResult.satisfied, true, "non-ambiguous identity must pass constraint");
});

// ---------------------------------------------------------------------------
// TEST 3 — Entity Present: Mismatch vs Match
// ---------------------------------------------------------------------------

test("Entity enforcement: entity.id=A + slot.required_entity_id=B → satisfied=false", () => {
  const identity = makeIdentity({
    entity: {
      entityId: "entity-aaa",
      entityRole: "borrower",
      confidence: 0.95,
      ambiguous: false,
      tier: "ein_match",
    },
  });

  const slot = makeSlot({ requiredEntityId: "entity-bbb" });

  const results = evaluateConstraints(identity, slot);

  const entityIdResult = results.find((r) => r.constraint === "entity_id_match");
  assert.ok(entityIdResult, "entity_id_match constraint must be present");
  assert.equal(
    entityIdResult.satisfied,
    false,
    "entity_id_match must FAIL when entity is present and mismatched",
  );
});

test("Entity enforcement: entity.id=A + slot.required_entity_id=A → satisfied=true", () => {
  const identity = makeIdentity({
    entity: {
      entityId: "entity-aaa",
      entityRole: "borrower",
      confidence: 0.95,
      ambiguous: false,
      tier: "ein_match",
    },
  });

  const slot = makeSlot({ requiredEntityId: "entity-aaa" });

  const results = evaluateConstraints(identity, slot);

  const entityIdResult = results.find((r) => r.constraint === "entity_id_match");
  assert.ok(entityIdResult, "entity_id_match constraint must be present");
  assert.equal(entityIdResult.satisfied, true, "entity_id_match must pass when entity matches");
});

// ---------------------------------------------------------------------------
// TEST 4 — Multi-Entity: entity=null → no auto_attach
// ---------------------------------------------------------------------------

test("Multi-entity: entity=null + 2 entity slots → no_match (v1.4.0 hard enforcement)", () => {
  const identity = makeIdentity({ entity: null, taxYear: 2024 });

  const slots: SlotSnapshot[] = [
    makeSlot({
      slotId: "slot-entity-a",
      slotKey: "BTR_2024_A",
      requiredEntityId: "entity-aaa",
    }),
    makeSlot({
      slotId: "slot-entity-b",
      slotKey: "BTR_2024_B",
      requiredEntityId: "entity-bbb",
    }),
  ];

  const result = matchDocumentToSlot(identity, slots);

  assert.equal(
    result.decision,
    "no_match",
    "entity=null + entity-required slots must be no_match — no soft-skip",
  );
});

test("Single-entity slot: entity=null → no_match (v1.4.0 hard enforcement)", () => {
  const identity = makeIdentity({ entity: null, taxYear: 2024 });

  const slots: SlotSnapshot[] = [
    makeSlot({
      slotId: "slot-entity-a",
      slotKey: "BTR_2024_A",
      requiredEntityId: "entity-aaa",
    }),
  ];

  const result = matchDocumentToSlot(identity, slots);

  assert.equal(
    result.decision,
    "no_match",
    "entity=null + entity-required slot must be no_match — v1.4.0 does not soft-skip",
  );
});

// ---------------------------------------------------------------------------
// TEST 5 — Role Enforcement
// ---------------------------------------------------------------------------

test("Entity role enforcement: entity.role=borrower + slot.required_entity_role=guarantor → satisfied=false", () => {
  const identity = makeIdentity({
    entity: {
      entityId: "entity-aaa",
      entityRole: "borrower",
      confidence: 0.95,
      ambiguous: false,
      tier: "ein_match",
    },
  });

  const slot = makeSlot({ requiredEntityRole: "guarantor" });

  const results = evaluateConstraints(identity, slot);

  const entityRoleResult = results.find((r) => r.constraint === "entity_role_match");
  assert.ok(entityRoleResult, "entity_role_match constraint must be present");
  assert.equal(
    entityRoleResult.satisfied,
    false,
    "entity_role_match must FAIL when role mismatches",
  );
});

// ---------------------------------------------------------------------------
// TEST 6 — No meta field on constraint results (v1.4.0)
// ---------------------------------------------------------------------------

test("Constraint results have no meta field (v1.4.0 — soft-skip removed)", () => {
  const identity = makeIdentity({ entity: null });
  const slot = makeSlot({ requiredEntityId: "entity-abc" });

  const results = evaluateConstraints(identity, slot);

  for (const result of results) {
    assert.equal(
      (result as Record<string, unknown>).meta,
      undefined,
      `Constraint ${result.constraint} must NOT have meta field — soft-skip removed in v1.4.0`,
    );
  }
});
