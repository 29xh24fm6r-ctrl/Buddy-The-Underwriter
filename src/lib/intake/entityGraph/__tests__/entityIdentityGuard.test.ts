/**
 * Entity Identity Guard — CI-Blocking Governance Invariants (Layer 2 v1.0)
 *
 * Validates that the identity instrumentation layer:
 *   1. Carries the correct ENTITY_GRAPH_VERSION constant (version audit)
 *   2. Fails open on empty registry — never blocks classification
 *   3. Produces deterministic EIN-match results (no random outcome)
 *   4. wrongAttachCount == 0 across entity-routing golden corpus
 *
 * Pure function tests — no DB, no IO, no side effects.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ENTITY_GRAPH_VERSION } from "../../identity/version";
import {
  resolveEntity,
  type EntityCandidate,
  type EntityTextSignals,
} from "../../identity/entityResolver";
import { matchDocumentToSlot } from "../../matching/matchEngine";
import type { DocumentIdentity, SlotSnapshot } from "../../matching/types";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function makeIdentity(overrides: Partial<DocumentIdentity>): DocumentIdentity {
  return {
    documentId: "identity-guard-doc",
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
        anchorId: "identity-guard",
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
// Golden corpus — entity-routing entries (subset of atomicMetricsGuard)
// ---------------------------------------------------------------------------

type GoldenEntry = {
  label: string;
  identity: DocumentIdentity;
  slots: SlotSnapshot[];
  expectedDecision: "auto_attached" | "routed_to_review" | "no_match";
  expectedSlotId: string | null;
};

const ENTITY_CORPUS: GoldenEntry[] = [
  {
    label: "#E1: BTR with entity match -> entity slot",
    identity: makeIdentity({
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
    label: "#E2: Ambiguous entity -> routed_to_review",
    identity: makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      rawDocType: "IRS_BUSINESS",
      taxYear: 2024,
      entityType: "business",
      entity: {
        entityId: null,
        entityRole: null,
        confidence: 0.70,
        ambiguous: true,
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
      makeSlot({
        slotId: "btr-2024-holdco",
        slotKey: "BTR_2024_HOLDCO",
        requiredDocType: "BUSINESS_TAX_RETURN",
        requiredTaxYear: 2024,
        slotGroup: "tax",
        sortOrder: 2,
        requiredEntityId: "ent-holdco",
      }),
    ],
    expectedDecision: "routed_to_review",
    expectedSlotId: null,
  },
  {
    label: "#E3: PFS with entity match -> entity slot",
    identity: makeIdentity({
      effectiveDocType: "PFS",
      rawDocType: "PFS",
      taxYear: null,
      entityType: "personal",
      authority: "probabilistic",
      confidence: 0.92,
      entity: {
        entityId: "ent-guar",
        entityRole: "guarantor",
        confidence: 0.90,
        ambiguous: false,
      },
    }),
    slots: [
      makeSlot({
        slotId: "pfs-guar",
        slotKey: "PFS_GUARANTOR",
        requiredDocType: "PERSONAL_FINANCIAL_STATEMENT",
        requiredTaxYear: null,
        slotGroup: "financial",
        sortOrder: 1,
        requiredEntityId: "ent-guar",
      }),
    ],
    expectedDecision: "auto_attached",
    expectedSlotId: "pfs-guar",
  },
  {
    label: "#E4: BTR with entity but entity-agnostic slots -> fallback auto_attached",
    identity: makeIdentity({
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
    }),
    slots: [
      makeSlot({
        slotId: "btr-2024",
        slotKey: "BTR_2024",
        requiredDocType: "BUSINESS_TAX_RETURN",
        requiredTaxYear: 2024,
        slotGroup: "tax",
        sortOrder: 1,
        // No requiredEntityId — entity-agnostic slot
      }),
    ],
    expectedDecision: "auto_attached",
    expectedSlotId: "btr-2024",
  },
  {
    label: "#E5: Entity mismatch -> no_match (wrong entity for slot)",
    identity: makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      rawDocType: "IRS_BUSINESS",
      taxYear: 2024,
      entityType: "business",
      entity: {
        entityId: "ent-holdco",
        entityRole: "holding",
        confidence: 0.95,
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
        requiredEntityId: "ent-opco", // Different entity
      }),
    ],
    expectedDecision: "no_match",
    expectedSlotId: null,
  },
];

// ---------------------------------------------------------------------------
// Guard 1: ENTITY_GRAPH_VERSION invariant
// ---------------------------------------------------------------------------

test("ENTITY_GRAPH_VERSION === 1 (identity layer version audit)", () => {
  assert.strictEqual(
    ENTITY_GRAPH_VERSION,
    1,
    `ENTITY_GRAPH_VERSION must be 1 for v1.0 observability activation, got ${ENTITY_GRAPH_VERSION}`,
  );
  console.log(`[identityGuard] ENTITY_GRAPH_VERSION = ${ENTITY_GRAPH_VERSION} ✓`);
});

// ---------------------------------------------------------------------------
// Guard 2: Empty registry → fail-open (null entity, tier: "none")
// ---------------------------------------------------------------------------

test("empty entity registry → null entity, tier: none (fail-open invariant)", () => {
  const signals: EntityTextSignals = {
    text: "Acme Corp 2024 Annual Report EIN 12-3456789",
    filename: "acme-2024.pdf",
    hasEin: true,
    hasSsn: false,
  };

  const result = resolveEntity(signals, []); // Empty candidates

  assert.strictEqual(
    result.entityId,
    null,
    "Empty registry must yield entityId: null",
  );
  assert.strictEqual(
    result.tier,
    "none",
    "Empty registry must yield tier: 'none'",
  );
  assert.strictEqual(
    result.ambiguous,
    false,
    "Empty registry must yield ambiguous: false",
  );
  assert.strictEqual(
    result.confidence,
    0,
    "Empty registry must yield confidence: 0",
  );

  console.log("[identityGuard] empty registry → null entity (fail-open) ✓");
});

// ---------------------------------------------------------------------------
// Guard 3: EIN match determinism
// ---------------------------------------------------------------------------

test("EIN last4 match is deterministic — same inputs always produce same entity", () => {
  const candidate: EntityCandidate = {
    entityId: "ent-opco-123",
    entityRole: "operating",
    legalName: "Acme Operating LLC",
    einLast4: "6789",
    ssnLast4: null,
    normalizedNameTokens: ["acme", "operating"],
  };

  const signals: EntityTextSignals = {
    // EIN pattern: 12-3456789 → last4 = "6789"
    text: "Federal Employer ID: 12-3456789. Prepared for Acme Operating LLC.",
    filename: "acme-tax-return-2024.pdf",
    hasEin: true,
    hasSsn: false,
  };

  // Run 3x — must be deterministic
  const r1 = resolveEntity(signals, [candidate]);
  const r2 = resolveEntity(signals, [candidate]);
  const r3 = resolveEntity(signals, [candidate]);

  for (const [i, result] of [[1, r1], [2, r2], [3, r3]] as const) {
    assert.strictEqual(
      result.entityId,
      "ent-opco-123",
      `Run ${i}: EIN match must resolve to candidate entityId`,
    );
    assert.strictEqual(
      result.tier,
      "ein_match",
      `Run ${i}: EIN match must yield tier: 'ein_match'`,
    );
    assert.strictEqual(
      result.ambiguous,
      false,
      `Run ${i}: Single EIN match must be unambiguous`,
    );
    assert.ok(
      result.confidence >= 0.90,
      `Run ${i}: EIN match confidence must be >= 0.90, got ${result.confidence}`,
    );
  }

  // All 3 runs must be identical
  assert.deepStrictEqual(r1, r2, "EIN match must be deterministic (run 1 == run 2)");
  assert.deepStrictEqual(r2, r3, "EIN match must be deterministic (run 2 == run 3)");

  console.log("[identityGuard] EIN determinism confirmed across 3 runs ✓");
});

// ---------------------------------------------------------------------------
// Guard 4: wrongAttachCount == 0 (entity governance invariant)
// ---------------------------------------------------------------------------

test("wrongAttachCount == 0 across entity-routing corpus", () => {
  let wrongAttachCount = 0;
  const wrongAttaches: string[] = [];

  for (const entry of ENTITY_CORPUS) {
    const result = matchDocumentToSlot(entry.identity, entry.slots);

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
    console.error("[identityGuard] Wrong attaches:\n" + wrongAttaches.join("\n"));
  }

  assert.strictEqual(
    wrongAttachCount,
    0,
    `Identity governance: wrongAttachCount must be 0, got ${wrongAttachCount}`,
  );

  console.log(
    `[identityGuard] wrongAttachCount == 0 across ${ENTITY_CORPUS.length} entity-routing entries ✓`,
  );
});
