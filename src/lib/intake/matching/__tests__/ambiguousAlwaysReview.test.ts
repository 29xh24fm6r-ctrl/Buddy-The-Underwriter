/**
 * Ambiguity Enforcement — v1.4.0 Behavioral Tests
 *
 * If identity.entity.ambiguous === true:
 *   - ALWAYS routed_to_review
 *   - Even if only one compatible slot exists
 *   - Even if no entity-aware slots exist
 *   - NEVER auto_attached
 *
 * This preserves trust in the entity resolution system.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { matchDocumentToSlot } from "../matchEngine";
import { checkEntityAmbiguity } from "../confidenceGate";
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
    slotKey: "BTR_2024",
    slotGroup: "tax_returns",
    requiredDocType: "BUSINESS_TAX_RETURN",
    requiredTaxYear: 2024,
    status: "empty",
    sortOrder: 1,
    ...overrides,
  };
}

const AMBIGUOUS_ENTITY = {
  entityId: null,
  entityRole: null,
  confidence: 0.95,
  ambiguous: true,
  tier: "ein_match" as const,
};

// ---------------------------------------------------------------------------
// TEST 1 — Ambiguous + 1 compatible slot → routed_to_review
// ---------------------------------------------------------------------------

test("Ambiguous identity + 1 compatible slot → routed_to_review (never auto_attach)", () => {
  const identity = makeIdentity({ entity: AMBIGUOUS_ENTITY });
  const slots: SlotSnapshot[] = [
    makeSlot({ slotId: "slot-1", requiredEntityId: "entity-aaa" }),
  ];

  const result = matchDocumentToSlot(identity, slots);

  assert.equal(result.decision, "routed_to_review");
  assert.equal(result.slotId, null);
});

// ---------------------------------------------------------------------------
// TEST 2 — Ambiguous + multiple compatible slots → routed_to_review
// ---------------------------------------------------------------------------

test("Ambiguous identity + multiple slots → routed_to_review", () => {
  const identity = makeIdentity({ entity: AMBIGUOUS_ENTITY });
  const slots: SlotSnapshot[] = [
    makeSlot({ slotId: "slot-1", requiredEntityId: "entity-aaa" }),
    makeSlot({ slotId: "slot-2", slotKey: "BTR_2024_B", requiredEntityId: "entity-bbb" }),
  ];

  const result = matchDocumentToSlot(identity, slots);

  assert.equal(result.decision, "routed_to_review");
  assert.equal(result.slotId, null);
});

// ---------------------------------------------------------------------------
// TEST 3 — Ambiguous + no entity-aware slots → still routed_to_review
// ---------------------------------------------------------------------------

test("Ambiguous identity + slots without entity requirements → still routed_to_review", () => {
  const identity = makeIdentity({ entity: AMBIGUOUS_ENTITY });
  const slots: SlotSnapshot[] = [
    makeSlot({ slotId: "slot-1", requiredEntityId: null }),
  ];

  const result = matchDocumentToSlot(identity, slots);

  assert.equal(
    result.decision,
    "routed_to_review",
    "Ambiguous ALWAYS routes to review, even without entity-aware slots",
  );
});

// ---------------------------------------------------------------------------
// TEST 4 — Non-ambiguous identity proceeds normally
// ---------------------------------------------------------------------------

test("Non-ambiguous identity + entity match → auto_attached", () => {
  const identity = makeIdentity({
    entity: {
      entityId: "entity-aaa",
      entityRole: "operating",
      confidence: 0.95,
      ambiguous: false,
      tier: "ein_match",
    },
  });
  const slots: SlotSnapshot[] = [
    makeSlot({ slotId: "slot-1", requiredEntityId: "entity-aaa" }),
  ];

  const result = matchDocumentToSlot(identity, slots);

  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "slot-1");
});

// ---------------------------------------------------------------------------
// TEST 5 — checkEntityAmbiguity unit test: unconditional
// ---------------------------------------------------------------------------

test("checkEntityAmbiguity: ambiguous=true → route_to_review regardless of slots", () => {
  const identity = makeIdentity({ entity: AMBIGUOUS_ENTITY });

  // No entity-aware slots
  const result = checkEntityAmbiguity(identity, [
    makeSlot({ requiredEntityId: null }),
  ]);

  assert.ok(result, "Must return a result when ambiguous");
  assert.equal(result!.decision, "route_to_review");
});

test("checkEntityAmbiguity: entity=null → null (no gate)", () => {
  const identity = makeIdentity({ entity: null });
  const result = checkEntityAmbiguity(identity, [makeSlot()]);
  assert.equal(result, null, "No entity = no ambiguity gate");
});

test("checkEntityAmbiguity: ambiguous=false → null (no gate)", () => {
  const identity = makeIdentity({
    entity: {
      entityId: "entity-aaa",
      entityRole: "operating",
      confidence: 0.95,
      ambiguous: false,
      tier: "ein_match",
    },
  });
  const result = checkEntityAmbiguity(identity, [makeSlot()]);
  assert.equal(result, null, "Non-ambiguous = no gate");
});
