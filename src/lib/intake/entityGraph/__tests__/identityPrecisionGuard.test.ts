/**
 * Identity Precision Guard — CI-Blocking Governance Invariants (Layer 2.2)
 *
 * Validates that the identity precision layer:
 *   1. ENTITY_PRECISION_THRESHOLD > ENTITY_PROTECTION_THRESHOLD (ordering audit)
 *   2. ENTITY_PRECISION_THRESHOLD >= 0.85 (precision tier audit)
 *   3. Pure engine still rejects entity mismatch even when ENABLE_ENTITY_PRECISION=true
 *      (constraints remain authoritative — precision does not bypass them)
 *   4. wrongAttachCount == 0 across precision corpus
 *
 * Pure function tests — no DB, no IO, no side effects.
 * Env vars set/restored per test to simulate feature flag states.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ENTITY_PRECISION_THRESHOLD, ENTITY_PROTECTION_THRESHOLD } from "../../identity/version";
import { matchDocumentToSlot } from "../../matching/matchEngine";
import type { DocumentIdentity, SlotSnapshot } from "../../matching/types";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function makeIdentity(overrides: Partial<DocumentIdentity>): DocumentIdentity {
  return {
    documentId: "precision-guard-doc",
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
        anchorId: "precision-guard",
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
// Precision corpus — entity-assisted ranking cases
// ---------------------------------------------------------------------------

type PrecisionEntry = {
  label: string;
  identity: DocumentIdentity;
  slots: SlotSnapshot[];
  expectedDecision: "auto_attached" | "routed_to_review" | "no_match";
  expectedSlotId: string | null;
};

// Corpus is evaluated with ENABLE_ENTITY_GRAPH=true, ENABLE_ENTITY_PRECISION=true
const PRECISION_CORPUS: PrecisionEntry[] = [
  {
    label: "#Q1: High-confidence entity match, single slot → auto_attached",
    identity: makeIdentity({
      effectiveDocType: "PERSONAL_TAX_RETURN",
      rawDocType: "IRS_PERSONAL",
      taxYear: 2024,
      entityType: "personal",
      entity: {
        entityId: "guarantor-1",
        entityRole: "guarantor",
        confidence: 0.92,
        ambiguous: false,
      },
    }),
    slots: [
      makeSlot({
        slotId: "ptr-2024-g1",
        slotKey: "PTR_2024_G1",
        requiredDocType: "PERSONAL_TAX_RETURN",
        requiredTaxYear: 2024,
        slotGroup: "tax",
        sortOrder: 1,
        requiredEntityId: "guarantor-1",
      }),
    ],
    expectedDecision: "auto_attached",
    expectedSlotId: "ptr-2024-g1",
  },
  {
    label: "#Q2: Entity mismatch with precision on → no_match (constraints block regardless)",
    identity: makeIdentity({
      effectiveDocType: "PERSONAL_TAX_RETURN",
      rawDocType: "IRS_PERSONAL",
      taxYear: 2024,
      entityType: "personal",
      entity: {
        entityId: "guarantor-2",
        entityRole: "guarantor",
        confidence: 0.92,
        ambiguous: false,
      },
    }),
    slots: [
      makeSlot({
        slotId: "ptr-2024-g1",
        slotKey: "PTR_2024_G1",
        requiredDocType: "PERSONAL_TAX_RETURN",
        requiredTaxYear: 2024,
        slotGroup: "tax",
        sortOrder: 1,
        requiredEntityId: "guarantor-1", // different entity — constraint blocks
      }),
    ],
    // Precision sort runs but constraint already eliminated this slot
    expectedDecision: "no_match",
    expectedSlotId: null,
  },
  {
    label: "#Q3: Below precision threshold (0.80) — sort does not activate",
    identity: makeIdentity({
      effectiveDocType: "PERSONAL_TAX_RETURN",
      rawDocType: "IRS_PERSONAL",
      taxYear: 2024,
      entityType: "personal",
      entity: {
        entityId: "guarantor-1",
        entityRole: "guarantor",
        confidence: 0.80, // below ENTITY_PRECISION_THRESHOLD (0.85) — sort does not apply
        ambiguous: false,
      },
    }),
    slots: [
      makeSlot({
        slotId: "ptr-2024-g1",
        slotKey: "PTR_2024_G1",
        requiredDocType: "PERSONAL_TAX_RETURN",
        requiredTaxYear: 2024,
        slotGroup: "tax",
        sortOrder: 1,
        requiredEntityId: "guarantor-1",
      }),
    ],
    // Single candidate, constraints pass — auto_attached regardless of sort
    expectedDecision: "auto_attached",
    expectedSlotId: "ptr-2024-g1",
  },
  {
    label: "#Q4: Null entity with precision on → no_match on entity-aware slot",
    identity: makeIdentity({
      effectiveDocType: "PERSONAL_TAX_RETURN",
      rawDocType: "IRS_PERSONAL",
      taxYear: 2024,
      entityType: "personal",
      entity: null, // no entity resolved
    }),
    slots: [
      makeSlot({
        slotId: "ptr-2024-g1",
        slotKey: "PTR_2024_G1",
        requiredDocType: "PERSONAL_TAX_RETURN",
        requiredTaxYear: 2024,
        slotGroup: "tax",
        sortOrder: 1,
        requiredEntityId: "guarantor-1",
      }),
    ],
    // No entity resolved → checkEntityIdMatch constraint fails → no_match
    expectedDecision: "no_match",
    expectedSlotId: null,
  },
];

// ---------------------------------------------------------------------------
// Guard 1: ENTITY_PRECISION_THRESHOLD > ENTITY_PROTECTION_THRESHOLD
// ---------------------------------------------------------------------------

test("ENTITY_PRECISION_THRESHOLD > ENTITY_PROTECTION_THRESHOLD (ordering audit)", () => {
  assert.ok(
    ENTITY_PRECISION_THRESHOLD > ENTITY_PROTECTION_THRESHOLD,
    `ENTITY_PRECISION_THRESHOLD (${ENTITY_PRECISION_THRESHOLD}) must be above ` +
      `ENTITY_PROTECTION_THRESHOLD (${ENTITY_PROTECTION_THRESHOLD})`,
  );
  console.log(
    `[precisionGuard] ${ENTITY_PRECISION_THRESHOLD} > ${ENTITY_PROTECTION_THRESHOLD} ✓`,
  );
});

// ---------------------------------------------------------------------------
// Guard 2: ENTITY_PRECISION_THRESHOLD >= 0.85
// ---------------------------------------------------------------------------

test("ENTITY_PRECISION_THRESHOLD >= 0.85 (precision tier audit)", () => {
  assert.ok(
    ENTITY_PRECISION_THRESHOLD >= 0.85,
    `ENTITY_PRECISION_THRESHOLD must be >= 0.85, got ${ENTITY_PRECISION_THRESHOLD}`,
  );
  console.log(`[precisionGuard] ENTITY_PRECISION_THRESHOLD = ${ENTITY_PRECISION_THRESHOLD} ✓`);
});

// ---------------------------------------------------------------------------
// Guard 3: Pure engine still rejects entity mismatch with precision on
// ---------------------------------------------------------------------------

test("pure engine: entity mismatch → no_match even with ENABLE_ENTITY_PRECISION=true", () => {
  // Simulate precision flag enabled
  const origGraph = process.env.ENABLE_ENTITY_GRAPH;
  const origPrecision = process.env.ENABLE_ENTITY_PRECISION;
  process.env.ENABLE_ENTITY_GRAPH = "true";
  process.env.ENABLE_ENTITY_PRECISION = "true";

  try {
    const result = matchDocumentToSlot(
      makeIdentity({
        effectiveDocType: "PERSONAL_TAX_RETURN",
        rawDocType: "IRS_PERSONAL",
        taxYear: 2024,
        entityType: "personal",
        entity: {
          entityId: "guarantor-2",
          entityRole: "guarantor",
          confidence: 0.95, // above precision threshold
          ambiguous: false,
        },
      }),
      [
        makeSlot({
          slotId: "ptr-2024-g1",
          slotKey: "PTR_2024_G1",
          requiredDocType: "PERSONAL_TAX_RETURN",
          requiredTaxYear: 2024,
          slotGroup: "tax",
          sortOrder: 1,
          requiredEntityId: "guarantor-1", // mismatch
        }),
      ],
      "conventional_v1",
    );

    assert.strictEqual(
      result.decision,
      "no_match",
      `Precision flag must not bypass entity constraint — expected no_match, got ${result.decision}`,
    );
    assert.notStrictEqual(
      result.decision,
      "auto_attached",
      "Entity mismatch must never produce auto_attached even with precision enabled",
    );
  } finally {
    // Restore env
    if (origGraph === undefined) {
      delete process.env.ENABLE_ENTITY_GRAPH;
    } else {
      process.env.ENABLE_ENTITY_GRAPH = origGraph;
    }
    if (origPrecision === undefined) {
      delete process.env.ENABLE_ENTITY_PRECISION;
    } else {
      process.env.ENABLE_ENTITY_PRECISION = origPrecision;
    }
  }

  console.log("[precisionGuard] entity mismatch → no_match with precision on confirmed ✓");
});

// ---------------------------------------------------------------------------
// Guard 4: wrongAttachCount == 0 across precision corpus
// ---------------------------------------------------------------------------

test("wrongAttachCount == 0 across precision corpus (with ENABLE_ENTITY_PRECISION=true)", () => {
  const origGraph = process.env.ENABLE_ENTITY_GRAPH;
  const origPrecision = process.env.ENABLE_ENTITY_PRECISION;
  process.env.ENABLE_ENTITY_GRAPH = "true";
  process.env.ENABLE_ENTITY_PRECISION = "true";

  let wrongAttachCount = 0;
  const wrongAttaches: string[] = [];

  try {
    for (const entry of PRECISION_CORPUS) {
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
  } finally {
    if (origGraph === undefined) {
      delete process.env.ENABLE_ENTITY_GRAPH;
    } else {
      process.env.ENABLE_ENTITY_GRAPH = origGraph;
    }
    if (origPrecision === undefined) {
      delete process.env.ENABLE_ENTITY_PRECISION;
    } else {
      process.env.ENABLE_ENTITY_PRECISION = origPrecision;
    }
  }

  if (wrongAttaches.length > 0) {
    console.error("[precisionGuard] Wrong attaches:\n" + wrongAttaches.join("\n"));
  }

  assert.strictEqual(
    wrongAttachCount,
    0,
    `Identity precision governance: wrongAttachCount must be 0, got ${wrongAttachCount}`,
  );

  console.log(
    `[precisionGuard] wrongAttachCount == 0 across ${PRECISION_CORPUS.length} precision corpus entries ✓`,
  );
});
