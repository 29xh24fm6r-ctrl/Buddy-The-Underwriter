/**
 * Golden Corpus — Multi-Entity Match Invariants (v1.3)
 *
 * Validates entity-aware routing: every document must land on
 * the correct entity's slot. Cross-entity attachment = wrong attach.
 *
 * Pure function tests — no DB, no IO, no side effects.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { matchDocumentToSlot } from "../matchEngine";
import type { DocumentIdentity, SlotSnapshot } from "../types";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function makeIdentity(overrides: Partial<DocumentIdentity>): DocumentIdentity {
  return {
    documentId: "entity-golden-doc",
    effectiveDocType: "OTHER",
    rawDocType: "OTHER",
    taxYear: null,
    entityType: null,
    formNumbers: null,
    authority: "deterministic",
    confidence: 0.97,
    classificationEvidence: [
      { type: "form_match", anchorId: "entity-golden", matchedText: "test", confidence: 0.97 },
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
// Multi-entity slot sets
// ---------------------------------------------------------------------------

/** Borrower (OPCO) + 1 Guarantor (PERSON) — standard SBA deal */
function borrowerGuarantorSlots(): SlotSnapshot[] {
  return [
    makeSlot({ slotId: "btr-2024-opco", slotKey: "BTR_2024_OPCO", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2024, slotGroup: "tax", sortOrder: 1, requiredEntityId: "ent-opco" }),
    makeSlot({ slotId: "btr-2023-opco", slotKey: "BTR_2023_OPCO", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2023, slotGroup: "tax", sortOrder: 2, requiredEntityId: "ent-opco" }),
    makeSlot({ slotId: "ptr-2024-g1", slotKey: "PTR_2024_G1", requiredDocType: "PERSONAL_TAX_RETURN", requiredTaxYear: 2024, slotGroup: "tax", sortOrder: 3, requiredEntityId: "ent-guarantor-1" }),
    makeSlot({ slotId: "ptr-2023-g1", slotKey: "PTR_2023_G1", requiredDocType: "PERSONAL_TAX_RETURN", requiredTaxYear: 2023, slotGroup: "tax", sortOrder: 4, requiredEntityId: "ent-guarantor-1" }),
    makeSlot({ slotId: "pfs-g1", slotKey: "PFS_G1", requiredDocType: "PERSONAL_FINANCIAL_STATEMENT", slotGroup: "financial", sortOrder: 5, requiredEntityId: "ent-guarantor-1" }),
  ];
}

/** Borrower (OPCO) + 2 Guarantors — multi-guarantor deal */
function twoGuarantorSlots(): SlotSnapshot[] {
  return [
    makeSlot({ slotId: "btr-2024-opco", slotKey: "BTR_2024_OPCO", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2024, slotGroup: "tax", sortOrder: 1, requiredEntityId: "ent-opco" }),
    makeSlot({ slotId: "ptr-2024-g1", slotKey: "PTR_2024_G1", requiredDocType: "PERSONAL_TAX_RETURN", requiredTaxYear: 2024, slotGroup: "tax", sortOrder: 2, requiredEntityId: "ent-guarantor-1" }),
    makeSlot({ slotId: "ptr-2024-g2", slotKey: "PTR_2024_G2", requiredDocType: "PERSONAL_TAX_RETURN", requiredTaxYear: 2024, slotGroup: "tax", sortOrder: 3, requiredEntityId: "ent-guarantor-2" }),
    makeSlot({ slotId: "pfs-g1", slotKey: "PFS_G1", requiredDocType: "PERSONAL_FINANCIAL_STATEMENT", slotGroup: "financial", sortOrder: 4, requiredEntityId: "ent-guarantor-1" }),
    makeSlot({ slotId: "pfs-g2", slotKey: "PFS_G2", requiredDocType: "PERSONAL_FINANCIAL_STATEMENT", slotGroup: "financial", sortOrder: 5, requiredEntityId: "ent-guarantor-2" }),
  ];
}

/** Borrower (OPCO) + HoldCo — multi-business entity deal */
function opcoHoldcoSlots(): SlotSnapshot[] {
  return [
    makeSlot({ slotId: "btr-2024-opco", slotKey: "BTR_2024_OPCO", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2024, slotGroup: "tax", sortOrder: 1, requiredEntityId: "ent-opco" }),
    makeSlot({ slotId: "btr-2024-holdco", slotKey: "BTR_2024_HOLDCO", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2024, slotGroup: "tax", sortOrder: 2, requiredEntityId: "ent-holdco" }),
  ];
}

// ---------------------------------------------------------------------------
// Golden entries
// ---------------------------------------------------------------------------

type GoldenEntry = {
  label: string;
  identity: DocumentIdentity;
  slots: SlotSnapshot[];
  expectedDecision: "auto_attached" | "routed_to_review" | "no_match";
  expectedSlotId: string | null;
};

const ENTITY_GOLDEN_CORPUS: GoldenEntry[] = [
  // ── E1: Guarantor PTR must NOT fill Borrower BTR slot ──────────────────
  {
    label: "#E1: Guarantor-1 PTR 2024 → PTR_2024_G1 (not any BTR slot)",
    identity: makeIdentity({
      effectiveDocType: "PERSONAL_TAX_RETURN",
      rawDocType: "IRS_PERSONAL",
      taxYear: 2024,
      entityType: "personal",
      entity: {
        entityId: "ent-guarantor-1",
        entityRole: "guarantor",
        confidence: 0.92,
        ambiguous: false,
      },
    }),
    slots: borrowerGuarantorSlots(),
    expectedDecision: "auto_attached",
    expectedSlotId: "ptr-2024-g1",
  },

  // ── E2: Guarantor-1 routes to G1, not G2 (two guarantors) ─────────────
  {
    label: "#E2: Guarantor-1 PTR 2024 → PTR_2024_G1 (not G2) in two-guarantor deal",
    identity: makeIdentity({
      effectiveDocType: "PERSONAL_TAX_RETURN",
      rawDocType: "IRS_PERSONAL",
      taxYear: 2024,
      entityType: "personal",
      entity: {
        entityId: "ent-guarantor-1",
        entityRole: "guarantor",
        confidence: 0.92,
        ambiguous: false,
      },
    }),
    slots: twoGuarantorSlots(),
    expectedDecision: "auto_attached",
    expectedSlotId: "ptr-2024-g1",
  },

  // ── E3: Guarantor-2 routes to G2 (two guarantors) ────────────────────
  {
    label: "#E3: Guarantor-2 PTR 2024 → PTR_2024_G2 in two-guarantor deal",
    identity: makeIdentity({
      effectiveDocType: "PERSONAL_TAX_RETURN",
      rawDocType: "IRS_PERSONAL",
      taxYear: 2024,
      entityType: "personal",
      entity: {
        entityId: "ent-guarantor-2",
        entityRole: "guarantor",
        confidence: 0.92,
        ambiguous: false,
      },
    }),
    slots: twoGuarantorSlots(),
    expectedDecision: "auto_attached",
    expectedSlotId: "ptr-2024-g2",
  },

  // ── E4: BTR routes to correct entity in OPCO + HoldCo deal ────────────
  {
    label: "#E4: OPCO BTR 2024 → BTR_2024_OPCO (not HoldCo)",
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
    slots: opcoHoldcoSlots(),
    expectedDecision: "auto_attached",
    expectedSlotId: "btr-2024-opco",
  },

  // ── E5: HoldCo BTR routes to HoldCo slot ─────────────────────────────
  {
    label: "#E5: HoldCo BTR 2024 → BTR_2024_HOLDCO (not OPCO)",
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
    slots: opcoHoldcoSlots(),
    expectedDecision: "auto_attached",
    expectedSlotId: "btr-2024-holdco",
  },

  // ── E6: Entity mismatch on all slots → no_match ──────────────────────
  {
    label: "#E6: Unknown entity BTR → no_match (no matching entity slot)",
    identity: makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      rawDocType: "IRS_BUSINESS",
      taxYear: 2024,
      entityType: "business",
      entity: {
        entityId: "ent-unknown",
        entityRole: "operating",
        confidence: 0.92,
        ambiguous: false,
      },
    }),
    slots: opcoHoldcoSlots(),
    expectedDecision: "no_match",
    expectedSlotId: null,
  },

  // ── E7: Missing entity on doc + entity-required slots → no_match ──────
  {
    label: "#E7: No entity resolved + entity-required slots → no_match",
    identity: makeIdentity({
      effectiveDocType: "PERSONAL_TAX_RETURN",
      rawDocType: "IRS_PERSONAL",
      taxYear: 2024,
      entityType: "personal",
      entity: null,
    }),
    slots: borrowerGuarantorSlots(),
    expectedDecision: "no_match",
    expectedSlotId: null,
  },

  // ── E8: Ambiguous entity → routed_to_review ──────────────────────────
  {
    label: "#E8: Ambiguous entity + multiple entity slots → routed_to_review",
    identity: makeIdentity({
      effectiveDocType: "PERSONAL_FINANCIAL_STATEMENT",
      rawDocType: "PFS",
      entityType: "personal",
      entity: {
        entityId: "ent-guarantor-1",
        entityRole: "guarantor",
        confidence: 0.55, // below auto-attach threshold for ambiguity
        ambiguous: true,
      },
    }),
    slots: twoGuarantorSlots(),
    expectedDecision: "routed_to_review",
    expectedSlotId: null,
  },

  // ── E9: PFS Guarantor-2 → PFS_G2 (not PFS_G1) ────────────────────────
  {
    label: "#E9: PFS for Guarantor-2 → PFS_G2 in two-guarantor deal",
    identity: makeIdentity({
      effectiveDocType: "PERSONAL_FINANCIAL_STATEMENT",
      rawDocType: "PFS",
      entityType: "personal",
      entity: {
        entityId: "ent-guarantor-2",
        entityRole: "guarantor",
        confidence: 0.92,
        ambiguous: false,
      },
    }),
    slots: twoGuarantorSlots(),
    expectedDecision: "auto_attached",
    expectedSlotId: "pfs-g2",
  },
];

// ---------------------------------------------------------------------------
// Test: each golden entry
// ---------------------------------------------------------------------------

for (const entry of ENTITY_GOLDEN_CORPUS) {
  test(`Entity Golden ${entry.label}`, () => {
    const result = matchDocumentToSlot(entry.identity, entry.slots, "conventional_v1");

    assert.strictEqual(
      result.decision,
      entry.expectedDecision,
      `${entry.label}: expected="${entry.expectedDecision}", got="${result.decision}" (reason: ${result.reason})`,
    );

    if (entry.expectedDecision === "auto_attached") {
      assert.strictEqual(
        result.slotId,
        entry.expectedSlotId,
        `${entry.label}: expected slotId="${entry.expectedSlotId}", got="${result.slotId}"`,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Aggregate: wrongAttachCount == 0
// ---------------------------------------------------------------------------

test("Entity Golden Corpus: wrongAttachCount == 0", () => {
  let wrongAttachCount = 0;
  const wrongAttaches: string[] = [];

  for (const entry of ENTITY_GOLDEN_CORPUS) {
    const result = matchDocumentToSlot(entry.identity, entry.slots, "conventional_v1");

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

    if (
      result.decision === "auto_attached" &&
      entry.expectedDecision !== "auto_attached"
    ) {
      wrongAttachCount++;
      wrongAttaches.push(
        `${entry.label}: expected "${entry.expectedDecision}", got auto_attached to "${result.slotId}"`,
      );
    }
  }

  if (wrongAttaches.length > 0) {
    console.error("[entityGolden] Wrong attaches:\n" + wrongAttaches.join("\n"));
  }

  assert.strictEqual(
    wrongAttachCount,
    0,
    `Entity golden corpus: wrongAttachCount must be 0, got ${wrongAttachCount}`,
  );

  console.log(
    `[entityGolden] wrongAttachCount == 0 across ${ENTITY_GOLDEN_CORPUS.length} entity corpus entries ✓`,
  );
});
