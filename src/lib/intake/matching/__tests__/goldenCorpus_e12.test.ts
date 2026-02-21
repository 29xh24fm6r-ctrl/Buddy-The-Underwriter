/**
 * Golden Corpus E1.2 — God Tier Invariants
 *
 * Extends the golden corpus with fixtures targeting real production failures:
 *   - Entity mismatch hard reject (#26, #27)
 *   - 1099 NOT BTR negative rule (#28)
 *   - Tie disambiguation (#29)
 *   - PFS low confidence gating (#30)
 *   - PTR entity-scoped match (#31)
 *   - RENT_ROLL no matching slot (#32)
 *
 * Every entry runs through matchDocumentToSlot().
 * Wrong-attach count must equal 0.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { matchDocumentToSlot } from "../matchEngine";
import type { DocumentIdentity, SlotSnapshot } from "../types";

// ---------------------------------------------------------------------------
// Identity builder
// ---------------------------------------------------------------------------

function makeIdentity(overrides: Partial<DocumentIdentity>): DocumentIdentity {
  return {
    documentId: "golden-e12-doc",
    effectiveDocType: "OTHER",
    rawDocType: "OTHER",
    taxYear: null,
    entityType: null,
    formNumbers: null,
    authority: "deterministic",
    confidence: 0.97,
    classificationEvidence: [
      { type: "form_match", anchorId: "golden", matchedText: "test", confidence: 0.97 },
    ],
    period: null,
    entity: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Slot builder
// ---------------------------------------------------------------------------

function makeSlot(
  overrides: Partial<SlotSnapshot> & Pick<SlotSnapshot, "slotId" | "slotKey" | "requiredDocType">,
): SlotSnapshot {
  return {
    slotGroup: "default",
    requiredTaxYear: null,
    status: "empty",
    sortOrder: 0,
    requiredEntityId: null,
    requiredEntityRole: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Golden corpus E1.2: Entity mismatch, 1099, ties, low confidence (#26–#32)
// ---------------------------------------------------------------------------

// #26: BTR 2024 + entity MISMATCH → no_match (hard reject)
test("Golden #26: BTR entity mismatch → no_match (hard reject)", () => {
  const identity = makeIdentity({
    effectiveDocType: "BUSINESS_TAX_RETURN",
    rawDocType: "IRS_BUSINESS",
    taxYear: 2024,
    entityType: "business",
    entity: {
      entityId: "ent-opco",
      entityRole: "operating",
      confidence: 0.95,
      ambiguous: false,
    },
  });
  // Slot requires a DIFFERENT entity
  const slots = [
    makeSlot({
      slotId: "btr-2024-holdco",
      slotKey: "BTR_2024_HOLDCO",
      slotGroup: "tax",
      requiredDocType: "BUSINESS_TAX_RETURN",
      requiredTaxYear: 2024,
      sortOrder: 1,
      requiredEntityId: "ent-holdco",
    }),
  ];
  const result = matchDocumentToSlot(identity, slots);
  assert.equal(result.decision, "no_match",
    "Entity mismatch (ent-opco vs ent-holdco) must be hard reject");
});

// #27: PFS + entity MISMATCH → no_match (hard reject)
test("Golden #27: PFS entity mismatch → no_match (hard reject)", () => {
  const identity = makeIdentity({
    effectiveDocType: "PFS",
    rawDocType: "PFS",
    taxYear: null,
    entityType: "personal",
    authority: "probabilistic",
    confidence: 0.92,
    entity: {
      entityId: "ent-guar-1",
      entityRole: "guarantor",
      confidence: 0.90,
      ambiguous: false,
    },
  });
  // Slot requires different guarantor entity
  const slots = [
    makeSlot({
      slotId: "pfs-guar-2",
      slotKey: "PFS_GUARANTOR_2",
      slotGroup: "financial",
      requiredDocType: "PERSONAL_FINANCIAL_STATEMENT",
      requiredTaxYear: null,
      sortOrder: 1,
      requiredEntityId: "ent-guar-2",
    }),
  ];
  const result = matchDocumentToSlot(identity, slots);
  assert.equal(result.decision, "no_match",
    "PFS entity mismatch must be hard reject");
});

// #28: 1099 (effective=PTR) + BTR-only slots → no_match (1099_NOT_BTR negative rule)
test("Golden #28: 1099 with only BTR slots → no_match (1099_NOT_BTR)", () => {
  const identity = makeIdentity({
    effectiveDocType: "PERSONAL_TAX_RETURN",
    rawDocType: "1099",
    taxYear: 2024,
    entityType: "personal",
    formNumbers: ["1099"],
  });
  const slots = [
    makeSlot({
      slotId: "btr-2024",
      slotKey: "BTR_2024",
      slotGroup: "tax",
      requiredDocType: "BUSINESS_TAX_RETURN",
      requiredTaxYear: 2024,
      sortOrder: 1,
    }),
  ];
  const result = matchDocumentToSlot(identity, slots);
  assert.equal(result.decision, "no_match",
    "1099 must NOT attach to BTR slot");
});

// #29: BTR 2024 + two matching slots (tie) → routed_to_review
test("Golden #29: BTR 2024 with two empty matching slots → routed_to_review (tie)", () => {
  const identity = makeIdentity({
    effectiveDocType: "BUSINESS_TAX_RETURN",
    rawDocType: "IRS_BUSINESS",
    taxYear: 2024,
    entityType: "business",
  });
  // Two matching BTR 2024 slots — no entity to disambiguate
  const slots = [
    makeSlot({
      slotId: "btr-2024-a",
      slotKey: "BTR_2024_A",
      slotGroup: "tax",
      requiredDocType: "BUSINESS_TAX_RETURN",
      requiredTaxYear: 2024,
      sortOrder: 1,
    }),
    makeSlot({
      slotId: "btr-2024-b",
      slotKey: "BTR_2024_B",
      slotGroup: "tax",
      requiredDocType: "BUSINESS_TAX_RETURN",
      requiredTaxYear: 2024,
      sortOrder: 2,
    }),
  ];
  const result = matchDocumentToSlot(identity, slots);
  assert.equal(result.decision, "routed_to_review",
    "Tie (>1 valid candidates) must route to review");
});

// #30: PFS low confidence (0.70, probabilistic) → routed_to_review
test("Golden #30: PFS low confidence 0.70 → routed_to_review", () => {
  const identity = makeIdentity({
    effectiveDocType: "PFS",
    rawDocType: "PFS",
    taxYear: null,
    entityType: "personal",
    authority: "probabilistic",
    confidence: 0.70,
  });
  const slots = [
    makeSlot({
      slotId: "pfs-1",
      slotKey: "PFS_CURRENT",
      slotGroup: "financial",
      requiredDocType: "PERSONAL_FINANCIAL_STATEMENT",
      requiredTaxYear: null,
      sortOrder: 1,
    }),
  ];
  const result = matchDocumentToSlot(identity, slots);
  assert.equal(result.decision, "routed_to_review",
    "PFS at 0.70 (probabilistic) is below 0.85 threshold — must not auto-attach");
});

// #31: PTR 2024 + guarantor entity → entity-scoped PTR slot
test("Golden #31: PTR with guarantor entity → entity-scoped PTR slot", () => {
  const identity = makeIdentity({
    effectiveDocType: "PERSONAL_TAX_RETURN",
    rawDocType: "IRS_PERSONAL",
    taxYear: 2024,
    entityType: "personal",
    entity: {
      entityId: "ent-guar",
      entityRole: "guarantor",
      confidence: 0.92,
      ambiguous: false,
    },
  });
  const slots = [
    makeSlot({
      slotId: "ptr-2024-guar",
      slotKey: "PTR_2024_GUARANTOR",
      slotGroup: "tax",
      requiredDocType: "PERSONAL_TAX_RETURN",
      requiredTaxYear: 2024,
      sortOrder: 1,
      requiredEntityId: "ent-guar",
    }),
  ];
  const result = matchDocumentToSlot(identity, slots);
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "ptr-2024-guar");
});

// #32: RENT_ROLL + no RR slot available → no_match
test("Golden #32: RENT_ROLL with no matching slot → no_match", () => {
  const identity = makeIdentity({
    effectiveDocType: "RENT_ROLL",
    rawDocType: "RENT_ROLL",
    taxYear: null,
    entityType: null,
    confidence: 0.92,
    authority: "probabilistic",
  });
  // Only tax + financial slots — no RENT_ROLL slot
  const slots = [
    makeSlot({
      slotId: "btr-2024",
      slotKey: "BTR_2024",
      slotGroup: "tax",
      requiredDocType: "BUSINESS_TAX_RETURN",
      requiredTaxYear: 2024,
      sortOrder: 1,
    }),
    makeSlot({
      slotId: "pfs-1",
      slotKey: "PFS_CURRENT",
      slotGroup: "financial",
      requiredDocType: "PERSONAL_FINANCIAL_STATEMENT",
      requiredTaxYear: null,
      sortOrder: 2,
    }),
  ];
  const result = matchDocumentToSlot(identity, slots);
  assert.equal(result.decision, "no_match",
    "RENT_ROLL must not attach to BTR or PFS slots");
});

// ─── CI Invariant: All E1.2 golden tests enforce zero wrong-attach ─────────
// Each test uses assert.equal for expected decision + slot.
// Entity mismatches are hard-rejected. Ties route to review. Low confidence blocked.
