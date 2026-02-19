/**
 * Identity Enforcement Guard — CI-Blocking Governance Invariants (Layer 2.1)
 *
 * Validates that the identity enforcement layer:
 *   1. Carries the correct ENTITY_PROTECTION_THRESHOLD constant (threshold audit)
 *   2. Threshold is correctly positioned in confidence space (0.70, 1.0)
 *   3. Pure engine constraint-level enforcement holds independently
 *      (high-confidence entity mismatch → no_match, not auto_attached)
 *   4. wrongAttachCount == 0 across enforcement corpus
 *
 * Pure function tests — no DB, no IO, no side effects.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ENTITY_PROTECTION_THRESHOLD } from "../../identity/version";
import { matchDocumentToSlot } from "../../matching/matchEngine";
import type { DocumentIdentity, SlotSnapshot } from "../../matching/types";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function makeIdentity(overrides: Partial<DocumentIdentity>): DocumentIdentity {
  return {
    documentId: "enforcement-guard-doc",
    effectiveDocType: "OTHER",
    rawDocType: "OTHER",
    taxYear: null,
    entityType: null,
    formNumbers: null,
    authority: "deterministic",
    confidence: 0.97,
    classificationEvidence: [
      {
        type: "form_match",
        anchorId: "enforcement-guard",
        matchedText: "test",
        confidence: 0.97,
      },
    ],
    period: null,
    entity: null,
    ...overrides,
  };
}

function makeSlot(
  overrides: Partial<SlotSnapshot> &
    Pick<SlotSnapshot, "slotId" | "slotKey" | "requiredDocType">,
): SlotSnapshot {
  return {
    slotGroup: "default",
    requiredTaxYear: null,
    status: "empty",
    sortOrder: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Enforcement corpus — protection invariant entries
// ---------------------------------------------------------------------------

type EnforcementEntry = {
  label: string;
  identity: DocumentIdentity;
  slots: SlotSnapshot[];
  expectedDecision: "auto_attached" | "routed_to_review" | "no_match";
  expectedSlotId: string | null;
};

const ENFORCEMENT_CORPUS: EnforcementEntry[] = [
  {
    label: "#P1: High confidence entity match → auto_attached to correct slot",
    identity: makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      rawDocType: "IRS_BUSINESS",
      taxYear: 2024,
      entityType: "business",
      entity: {
        entityId: "ent-opco",
        entityRole: "operating",
        confidence: 0.92,
        ambiguous: false,
      },
    }),
    slots: [
      makeSlot({
        slotId: "btr-2024-opco",
        slotKey: "BTR_2024_OPCO",
        requiredDocType: "BUSINESS_TAX_RETURN",
        requiredTaxYear: 2024,
        slotGroup: "tax",
        sortOrder: 1,
        requiredEntityId: "ent-opco",
      }),
    ],
    expectedDecision: "auto_attached",
    expectedSlotId: "btr-2024-opco",
  },
  {
    label: "#P2: High confidence mismatch → no_match (constraint blocks at engine level)",
    identity: makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      rawDocType: "IRS_BUSINESS",
      taxYear: 2024,
      entityType: "business",
      entity: {
        entityId: "ent-holdco",
        entityRole: "holding",
        confidence: 0.92,
        ambiguous: false,
      },
    }),
    slots: [
      makeSlot({
        slotId: "btr-2024-opco",
        slotKey: "BTR_2024_OPCO",
        requiredDocType: "BUSINESS_TAX_RETURN",
        requiredTaxYear: 2024,
        slotGroup: "tax",
        sortOrder: 1,
        requiredEntityId: "ent-opco", // different entity
      }),
    ],
    // Pure engine: checkEntityIdMatch constraint fails → no slot candidate → no_match
    expectedDecision: "no_match",
    expectedSlotId: null,
  },
  {
    label: "#P3: Low confidence entity mismatch (0.60) → no_match (constraint blocks regardless of threshold)",
    identity: makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      rawDocType: "IRS_BUSINESS",
      taxYear: 2024,
      entityType: "business",
      entity: {
        entityId: "ent-holdco",
        entityRole: "holding",
        confidence: 0.60, // below ENTITY_PROTECTION_THRESHOLD but constraint still applies
        ambiguous: false,
      },
    }),
    slots: [
      makeSlot({
        slotId: "btr-2024-opco",
        slotKey: "BTR_2024_OPCO",
        requiredDocType: "BUSINESS_TAX_RETURN",
        requiredTaxYear: 2024,
        slotGroup: "tax",
        sortOrder: 1,
        requiredEntityId: "ent-opco",
      }),
    ],
    // Pure engine constraint does not care about threshold — mismatch is mismatch
    expectedDecision: "no_match",
    expectedSlotId: null,
  },
  {
    label: "#P4: Null entity + entity-aware slot → no_match (checkEntityIdMatch fails: no entity resolved)",
    identity: makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      rawDocType: "IRS_BUSINESS",
      taxYear: 2024,
      entityType: "business",
      entity: null, // ENABLE_ENTITY_GRAPH=false or resolution returned null
    }),
    slots: [
      makeSlot({
        slotId: "btr-2024-opco",
        slotKey: "BTR_2024_OPCO",
        requiredDocType: "BUSINESS_TAX_RETURN",
        requiredTaxYear: 2024,
        slotGroup: "tax",
        sortOrder: 1,
        requiredEntityId: "ent-opco",
      }),
    ],
    // checkEntityIdMatch: slot has requiredEntityId but no entity resolved → satisfied: false
    expectedDecision: "no_match",
    expectedSlotId: null,
  },
];

// ---------------------------------------------------------------------------
// Guard 1: ENTITY_PROTECTION_THRESHOLD constant locked at 0.75
// ---------------------------------------------------------------------------

test("ENTITY_PROTECTION_THRESHOLD === 0.75 (threshold audit)", () => {
  assert.strictEqual(
    ENTITY_PROTECTION_THRESHOLD,
    0.75,
    `ENTITY_PROTECTION_THRESHOLD must be 0.75, got ${ENTITY_PROTECTION_THRESHOLD}`,
  );
  console.log(`[enforcementGuard] ENTITY_PROTECTION_THRESHOLD = ${ENTITY_PROTECTION_THRESHOLD} ✓`);
});

// ---------------------------------------------------------------------------
// Guard 2: Threshold correctly positioned in confidence space
// ---------------------------------------------------------------------------

test("ENTITY_PROTECTION_THRESHOLD bounded in (0.70, 1.0)", () => {
  assert.ok(
    ENTITY_PROTECTION_THRESHOLD > 0.70,
    `Threshold must be > 0.70 (above fuzzy name-match tier), got ${ENTITY_PROTECTION_THRESHOLD}`,
  );
  assert.ok(
    ENTITY_PROTECTION_THRESHOLD < 1.0,
    `Threshold must be < 1.0 (below certainty), got ${ENTITY_PROTECTION_THRESHOLD}`,
  );
  console.log(
    `[enforcementGuard] threshold ${ENTITY_PROTECTION_THRESHOLD} in (0.70, 1.0) ✓`,
  );
});

// ---------------------------------------------------------------------------
// Guard 3: Pure engine constraint-level enforcement holds independently
// ---------------------------------------------------------------------------

test("pure engine: high-confidence entity mismatch → no_match (not auto_attached)", () => {
  const result = matchDocumentToSlot(
    makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      rawDocType: "IRS_BUSINESS",
      taxYear: 2024,
      entityType: "business",
      entity: {
        entityId: "ent-holdco",
        entityRole: "holding",
        confidence: 0.92,
        ambiguous: false,
      },
    }),
    [
      makeSlot({
        slotId: "btr-2024-opco",
        slotKey: "BTR_2024_OPCO",
        requiredDocType: "BUSINESS_TAX_RETURN",
        requiredTaxYear: 2024,
        slotGroup: "tax",
        sortOrder: 1,
        requiredEntityId: "ent-opco",
      }),
    ],
    "conventional_v1",
  );

  assert.strictEqual(
    result.decision,
    "no_match",
    `Pure engine must return no_match for entity mismatch, got ${result.decision} (reason: ${result.reason})`,
  );
  assert.notStrictEqual(
    result.decision,
    "auto_attached",
    "Entity mismatch must never produce auto_attached from pure engine",
  );

  console.log("[enforcementGuard] pure engine entity mismatch → no_match confirmed ✓");
});

// ---------------------------------------------------------------------------
// Guard 4: wrongAttachCount == 0 across enforcement corpus
// ---------------------------------------------------------------------------

test("wrongAttachCount == 0 across enforcement corpus", () => {
  let wrongAttachCount = 0;
  const wrongAttaches: string[] = [];

  for (const entry of ENFORCEMENT_CORPUS) {
    const result = matchDocumentToSlot(entry.identity, entry.slots, "conventional_v1");

    // Wrong attach: auto_attached to wrong slot
    if (
      result.decision === "auto_attached" &&
      entry.expectedDecision === "auto_attached" &&
      result.slotId !== entry.expectedSlotId
    ) {
      wrongAttachCount++;
      wrongAttaches.push(
        `${entry.label}: expected slotId="${entry.expectedSlotId}", got slotId="${result.slotId}"`,
      );
    }

    // Wrong attach: auto_attached when we expected something else
    if (
      result.decision === "auto_attached" &&
      entry.expectedDecision !== "auto_attached"
    ) {
      wrongAttachCount++;
      wrongAttaches.push(
        `${entry.label}: expected decision="${entry.expectedDecision}", got auto_attached to slotId="${result.slotId}"`,
      );
    }

    // Verify decision matches expected
    assert.strictEqual(
      result.decision,
      entry.expectedDecision,
      `${entry.label}: expected="${entry.expectedDecision}", got="${result.decision}" (reason: ${result.reason})`,
    );

    // If auto_attached, verify correct slot
    if (
      entry.expectedDecision === "auto_attached" &&
      result.decision === "auto_attached"
    ) {
      assert.strictEqual(
        result.slotId,
        entry.expectedSlotId,
        `${entry.label}: expected slotId="${entry.expectedSlotId}", got "${result.slotId}"`,
      );
    }
  }

  if (wrongAttaches.length > 0) {
    console.error("[enforcementGuard] Wrong attaches:\n" + wrongAttaches.join("\n"));
  }

  assert.strictEqual(
    wrongAttachCount,
    0,
    `Identity enforcement governance: wrongAttachCount must be 0, got ${wrongAttachCount}`,
  );

  console.log(
    `[enforcementGuard] wrongAttachCount == 0 across ${ENFORCEMENT_CORPUS.length} enforcement corpus entries ✓`,
  );
});
