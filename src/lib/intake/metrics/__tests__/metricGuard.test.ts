/**
 * Metric Guard — CI-Blocking Wrong-Attach Invariant
 *
 * Runs the full golden corpus through matchDocumentToSlot() and asserts:
 *   1. wrongAttachCount === 0 (CI gate)
 *   2. auto-attach rate is logged (informational, no assertion)
 *   3. Golden corpus has >= 25 entries (minimum coverage)
 *
 * Pure function test — no DB, no IO.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { matchDocumentToSlot } from "../../matching/matchEngine";
import type {
  DocumentIdentity,
  SlotSnapshot,
  MatchResult,
} from "../../matching/types";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function makeIdentity(
  overrides: Partial<DocumentIdentity>,
): DocumentIdentity {
  return {
    documentId: "metric-guard-doc",
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
        anchorId: "guard",
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
// Standard slot set — realistic conventional policy
// ---------------------------------------------------------------------------

function standardSlots(): SlotSnapshot[] {
  return [
    makeSlot({
      slotId: "btr-2024",
      slotKey: "BTR_2024",
      requiredDocType: "BUSINESS_TAX_RETURN",
      requiredTaxYear: 2024,
      slotGroup: "tax",
      sortOrder: 1,
    }),
    makeSlot({
      slotId: "btr-2023",
      slotKey: "BTR_2023",
      requiredDocType: "BUSINESS_TAX_RETURN",
      requiredTaxYear: 2023,
      slotGroup: "tax",
      sortOrder: 2,
    }),
    makeSlot({
      slotId: "btr-2022",
      slotKey: "BTR_2022",
      requiredDocType: "BUSINESS_TAX_RETURN",
      requiredTaxYear: 2022,
      slotGroup: "tax",
      sortOrder: 3,
    }),
    makeSlot({
      slotId: "ptr-2024",
      slotKey: "PTR_2024",
      requiredDocType: "PERSONAL_TAX_RETURN",
      requiredTaxYear: 2024,
      slotGroup: "tax",
      sortOrder: 4,
    }),
    makeSlot({
      slotId: "ptr-2023",
      slotKey: "PTR_2023",
      requiredDocType: "PERSONAL_TAX_RETURN",
      requiredTaxYear: 2023,
      slotGroup: "tax",
      sortOrder: 5,
    }),
    makeSlot({
      slotId: "ptr-2022",
      slotKey: "PTR_2022",
      requiredDocType: "PERSONAL_TAX_RETURN",
      requiredTaxYear: 2022,
      slotGroup: "tax",
      sortOrder: 6,
    }),
    makeSlot({
      slotId: "pfs-1",
      slotKey: "PFS_CURRENT",
      requiredDocType: "PERSONAL_FINANCIAL_STATEMENT",
      slotGroup: "financial",
      sortOrder: 7,
    }),
    makeSlot({
      slotId: "is-1",
      slotKey: "IS_YTD",
      requiredDocType: "INCOME_STATEMENT",
      slotGroup: "financial",
      sortOrder: 8,
    }),
    makeSlot({
      slotId: "bs-1",
      slotKey: "BS_YTD",
      requiredDocType: "BALANCE_SHEET",
      slotGroup: "financial",
      sortOrder: 9,
    }),
    makeSlot({
      slotId: "rr-1",
      slotKey: "RENT_ROLL",
      requiredDocType: "RENT_ROLL",
      slotGroup: "property",
      sortOrder: 10,
    }),
  ];
}

// ---------------------------------------------------------------------------
// Golden Corpus — comprehensive entries
// ---------------------------------------------------------------------------

type GoldenEntry = {
  label: string;
  identity: DocumentIdentity;
  slots: SlotSnapshot[];
  expectedDecision: "auto_attached" | "routed_to_review" | "no_match";
  /** If auto_attached, the expected slotId. Null for review/no_match. */
  expectedSlotId: string | null;
};

const GOLDEN_CORPUS: GoldenEntry[] = [
  // ── Tax returns: year-matched attach ──────────────────────────────────
  {
    label: "#1: BTR 2024 -> BTR_2024 slot",
    identity: makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      rawDocType: "IRS_BUSINESS",
      taxYear: 2024,
      entityType: "business",
    }),
    slots: standardSlots(),
    expectedDecision: "auto_attached",
    expectedSlotId: "btr-2024",
  },
  {
    label: "#2: BTR 2023 -> BTR_2023 slot",
    identity: makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      rawDocType: "IRS_BUSINESS",
      taxYear: 2023,
      entityType: "business",
    }),
    slots: standardSlots(),
    expectedDecision: "auto_attached",
    expectedSlotId: "btr-2023",
  },
  {
    label: "#3: BTR 2022 -> BTR_2022 slot",
    identity: makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      rawDocType: "IRS_BUSINESS",
      taxYear: 2022,
      entityType: "business",
    }),
    slots: standardSlots(),
    expectedDecision: "auto_attached",
    expectedSlotId: "btr-2022",
  },
  {
    label: "#4: PTR 2024 -> PTR_2024 slot",
    identity: makeIdentity({
      effectiveDocType: "PERSONAL_TAX_RETURN",
      rawDocType: "IRS_PERSONAL",
      taxYear: 2024,
      entityType: "personal",
    }),
    slots: standardSlots(),
    expectedDecision: "auto_attached",
    expectedSlotId: "ptr-2024",
  },
  {
    label: "#5: PTR 2023 -> PTR_2023 slot",
    identity: makeIdentity({
      effectiveDocType: "PERSONAL_TAX_RETURN",
      rawDocType: "IRS_PERSONAL",
      taxYear: 2023,
      entityType: "personal",
    }),
    slots: standardSlots(),
    expectedDecision: "auto_attached",
    expectedSlotId: "ptr-2023",
  },
  {
    label: "#6: PTR 2022 -> PTR_2022 slot",
    identity: makeIdentity({
      effectiveDocType: "PERSONAL_TAX_RETURN",
      rawDocType: "IRS_PERSONAL",
      taxYear: 2022,
      entityType: "personal",
    }),
    slots: standardSlots(),
    expectedDecision: "auto_attached",
    expectedSlotId: "ptr-2022",
  },

  // ── K-1, W-2 crossover (must go to PTR, NOT BTR) ─────────────────────
  {
    label: "#7: K-1 2024 -> PTR_2024 (NOT BTR)",
    identity: makeIdentity({
      effectiveDocType: "PERSONAL_TAX_RETURN",
      rawDocType: "K1",
      taxYear: 2024,
      entityType: "personal",
    }),
    slots: standardSlots(),
    expectedDecision: "auto_attached",
    expectedSlotId: "ptr-2024",
  },
  {
    label: "#8: W-2 2024 -> PTR_2024 (NOT BTR)",
    identity: makeIdentity({
      effectiveDocType: "PERSONAL_TAX_RETURN",
      rawDocType: "W2",
      taxYear: 2024,
      entityType: "personal",
    }),
    slots: standardSlots(),
    expectedDecision: "auto_attached",
    expectedSlotId: "ptr-2024",
  },

  // ── Financial statements ──────────────────────────────────────────────
  {
    label: "#9: PFS -> PFS_CURRENT (NOT BS, NOT IS)",
    identity: makeIdentity({
      effectiveDocType: "PFS",
      rawDocType: "PFS",
      taxYear: null,
      entityType: "personal",
      authority: "probabilistic",
      confidence: 0.92,
    }),
    slots: standardSlots(),
    expectedDecision: "auto_attached",
    expectedSlotId: "pfs-1",
  },
  {
    label: "#10: INCOME_STATEMENT -> IS_YTD (NOT BS)",
    identity: makeIdentity({
      effectiveDocType: "INCOME_STATEMENT",
      rawDocType: "INCOME_STATEMENT",
      taxYear: null,
      entityType: null,
      confidence: 0.92,
    }),
    slots: standardSlots(),
    expectedDecision: "auto_attached",
    expectedSlotId: "is-1",
  },
  {
    label: "#11: BALANCE_SHEET -> BS_YTD (NOT IS)",
    identity: makeIdentity({
      effectiveDocType: "BALANCE_SHEET",
      rawDocType: "BALANCE_SHEET",
      taxYear: null,
      entityType: null,
      confidence: 0.93,
    }),
    slots: standardSlots(),
    expectedDecision: "auto_attached",
    expectedSlotId: "bs-1",
  },
  {
    label: "#12: RENT_ROLL -> RENT_ROLL slot",
    identity: makeIdentity({
      effectiveDocType: "RENT_ROLL",
      rawDocType: "RENT_ROLL",
      taxYear: null,
      entityType: null,
      confidence: 0.95,
    }),
    slots: standardSlots(),
    expectedDecision: "auto_attached",
    expectedSlotId: "rr-1",
  },

  // ── Negative rules & gating ───────────────────────────────────────────
  {
    label: "#13: FINANCIAL_STATEMENT umbrella -> never auto_attached (blocked by UMBRELLA_NO_AUTO_MATCH)",
    identity: makeIdentity({
      effectiveDocType: "FINANCIAL_STATEMENT",
      rawDocType: "FINANCIAL_STATEMENT",
      taxYear: null,
      entityType: null,
    }),
    slots: standardSlots(),
    expectedDecision: "no_match",
    expectedSlotId: null,
  },
  {
    label: "#14: BTR no year -> no_match",
    identity: makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      rawDocType: "IRS_BUSINESS",
      taxYear: null,
      entityType: "business",
    }),
    slots: standardSlots(),
    expectedDecision: "no_match",
    expectedSlotId: null,
  },
  {
    label: "#15: Low confidence (0.65) -> routed_to_review",
    identity: makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      taxYear: 2024,
      confidence: 0.65,
      authority: "deterministic",
    }),
    slots: standardSlots(),
    expectedDecision: "routed_to_review",
    expectedSlotId: null,
  },
  {
    label: "#16: Probabilistic at 0.83 -> routed_to_review",
    identity: makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      taxYear: 2024,
      confidence: 0.83,
      authority: "probabilistic",
    }),
    slots: standardSlots(),
    expectedDecision: "routed_to_review",
    expectedSlotId: null,
  },
  {
    label: "#17: BTR 2024 when slot filled -> no_match",
    identity: makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      rawDocType: "IRS_BUSINESS",
      taxYear: 2024,
      entityType: "business",
    }),
    slots: standardSlots().map((s) =>
      s.slotId === "btr-2024" ? { ...s, status: "attached" } : s,
    ),
    expectedDecision: "no_match",
    expectedSlotId: null,
  },
  {
    label: "#18: PFS with only BTR slot available -> no_match",
    identity: makeIdentity({
      effectiveDocType: "PFS",
      rawDocType: "PFS",
      taxYear: null,
      entityType: "personal",
      authority: "probabilistic",
      confidence: 0.92,
    }),
    slots: [
      makeSlot({
        slotId: "btr-2024",
        slotKey: "BTR_2024",
        requiredDocType: "BUSINESS_TAX_RETURN",
        requiredTaxYear: 2024,
        slotGroup: "tax",
        sortOrder: 1,
      }),
    ],
    expectedDecision: "no_match",
    expectedSlotId: null,
  },
  {
    label: "#19: OTHER doc type -> no_match",
    identity: makeIdentity({
      effectiveDocType: "OTHER",
      rawDocType: "OTHER",
    }),
    slots: standardSlots(),
    expectedDecision: "no_match",
    expectedSlotId: null,
  },

  // ── Period gating (v1.1) ──────────────────────────────────────────────
  {
    label: "#20: Multi-year BTR blocks year-bound slot",
    identity: makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      rawDocType: "IRS_BUSINESS",
      taxYear: 2024,
      entityType: "business",
      period: {
        periodStart: "2023-01-01",
        periodEnd: "2024-12-31",
        statementType: "annual",
        multiYear: true,
        taxYearConfidence: 0.95,
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
      }),
    ],
    expectedDecision: "no_match",
    expectedSlotId: null,
  },
  {
    label: "#21: Low year confidence blocks year slot",
    identity: makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      rawDocType: "IRS_BUSINESS",
      taxYear: 2024,
      entityType: "business",
      period: {
        periodStart: null,
        periodEnd: null,
        statementType: "annual",
        multiYear: false,
        taxYearConfidence: 0.50,
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
      }),
    ],
    expectedDecision: "no_match",
    expectedSlotId: null,
  },

  // ── Entity routing (v1.1) ─────────────────────────────────────────────
  {
    label: "#22: BTR with entity match -> entity slot",
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
    label: "#23: Ambiguous entity -> routed_to_review",
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
    label: "#24: PFS with entity match -> entity slot",
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

  // ── Statement types (v1.1) ────────────────────────────────────────────
  {
    label: "#25: IS YTD matches IS slot",
    identity: makeIdentity({
      effectiveDocType: "INCOME_STATEMENT",
      rawDocType: "INCOME_STATEMENT",
      taxYear: null,
      entityType: null,
      confidence: 0.92,
      period: {
        periodStart: "2025-01-01",
        periodEnd: "2025-09-30",
        statementType: "ytd",
        multiYear: false,
        taxYearConfidence: 0.75,
      },
    }),
    slots: [
      makeSlot({
        slotId: "is-1",
        slotKey: "IS_YTD",
        requiredDocType: "INCOME_STATEMENT",
        requiredTaxYear: null,
        slotGroup: "financial",
        sortOrder: 1,
      }),
    ],
    expectedDecision: "auto_attached",
    expectedSlotId: "is-1",
  },
  {
    label: "#26: TTM income statement matches IS slot",
    identity: makeIdentity({
      effectiveDocType: "INCOME_STATEMENT",
      rawDocType: "INCOME_STATEMENT",
      taxYear: null,
      entityType: null,
      confidence: 0.92,
      period: {
        periodStart: "2024-10-01",
        periodEnd: "2025-09-30",
        statementType: "ttm",
        multiYear: false,
        taxYearConfidence: 0.0,
      },
    }),
    slots: [
      makeSlot({
        slotId: "is-1",
        slotKey: "IS_YTD",
        requiredDocType: "INCOME_STATEMENT",
        requiredTaxYear: null,
        slotGroup: "financial",
        sortOrder: 1,
      }),
    ],
    expectedDecision: "auto_attached",
    expectedSlotId: "is-1",
  },

  // ── Specific form-to-slot mappings ────────────────────────────────────
  {
    label: "#27: SBA-413 (PFS type) matches PFS slot",
    identity: makeIdentity({
      effectiveDocType: "PFS",
      rawDocType: "SBA_413",
      taxYear: null,
      entityType: "personal",
      authority: "deterministic",
      confidence: 0.97,
      formNumbers: ["SBA-413"],
    }),
    slots: [
      makeSlot({
        slotId: "pfs-1",
        slotKey: "PFS_CURRENT",
        requiredDocType: "PERSONAL_FINANCIAL_STATEMENT",
        slotGroup: "financial",
        sortOrder: 1,
      }),
    ],
    expectedDecision: "auto_attached",
    expectedSlotId: "pfs-1",
  },
  {
    label: "#28: 1040-SR (PTR type) matches PTR_2024 slot",
    identity: makeIdentity({
      effectiveDocType: "PERSONAL_TAX_RETURN",
      rawDocType: "1040_SR",
      taxYear: 2024,
      entityType: "personal",
      authority: "deterministic",
      confidence: 0.97,
      formNumbers: ["1040-SR"],
    }),
    slots: [
      makeSlot({
        slotId: "ptr-2024",
        slotKey: "PTR_2024",
        requiredDocType: "PERSONAL_TAX_RETURN",
        requiredTaxYear: 2024,
        slotGroup: "tax",
        sortOrder: 1,
      }),
    ],
    expectedDecision: "auto_attached",
    expectedSlotId: "ptr-2024",
  },
  {
    label: "#29: INSURANCE with no matching slot -> no_match",
    identity: makeIdentity({
      effectiveDocType: "INSURANCE",
      rawDocType: "INSURANCE",
      taxYear: null,
      entityType: null,
    }),
    slots: [
      makeSlot({
        slotId: "btr-2024",
        slotKey: "BTR_2024",
        requiredDocType: "BUSINESS_TAX_RETURN",
        requiredTaxYear: 2024,
        slotGroup: "tax",
        sortOrder: 1,
      }),
      makeSlot({
        slotId: "pfs-1",
        slotKey: "PFS_CURRENT",
        requiredDocType: "PERSONAL_FINANCIAL_STATEMENT",
        slotGroup: "financial",
        sortOrder: 2,
      }),
    ],
    expectedDecision: "no_match",
    expectedSlotId: null,
  },
  {
    label: "#30: K-1 2023 -> PTR_2023 (NOT BTR_2023)",
    identity: makeIdentity({
      effectiveDocType: "PERSONAL_TAX_RETURN",
      rawDocType: "K1",
      taxYear: 2023,
      entityType: "personal",
    }),
    slots: standardSlots(),
    expectedDecision: "auto_attached",
    expectedSlotId: "ptr-2023",
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("golden corpus has minimum coverage (>= 25 entries)", () => {
  assert.ok(
    GOLDEN_CORPUS.length >= 25,
    `Expected >= 25 golden entries, got ${GOLDEN_CORPUS.length}`,
  );
});

test("wrongAttachCount == 0 across all golden entries", () => {
  let wrongAttachCount = 0;
  const wrongAttaches: string[] = [];

  for (const entry of GOLDEN_CORPUS) {
    const result: MatchResult = matchDocumentToSlot(entry.identity, entry.slots);

    // A "wrong attach" is: decision is auto_attached but slotId does not match expected
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

    // Also count as wrong attach: decision is auto_attached but we expected something else
    if (
      result.decision === "auto_attached" &&
      entry.expectedDecision !== "auto_attached"
    ) {
      wrongAttachCount++;
      wrongAttaches.push(
        `${entry.label}: expected decision="${entry.expectedDecision}", got auto_attached to slotId="${result.slotId}"`,
      );
    }

    // Verify the decision matches expected
    assert.equal(
      result.decision,
      entry.expectedDecision,
      `${entry.label}: expected decision="${entry.expectedDecision}", got "${result.decision}" (reason: ${result.reason})`,
    );

    // If auto_attached, verify correct slot
    if (
      entry.expectedDecision === "auto_attached" &&
      result.decision === "auto_attached"
    ) {
      assert.equal(
        result.slotId,
        entry.expectedSlotId,
        `${entry.label}: expected slotId="${entry.expectedSlotId}", got "${result.slotId}"`,
      );
    }
  }

  if (wrongAttaches.length > 0) {
    console.error("Wrong attaches:\n" + wrongAttaches.join("\n"));
  }

  assert.equal(
    wrongAttachCount,
    0,
    `Wrong attach count must be 0, got ${wrongAttachCount}`,
  );
});

test("auto-attach rate is logged", () => {
  let autoAttachedCount = 0;
  let totalMatchEvents = 0;

  for (const entry of GOLDEN_CORPUS) {
    const result: MatchResult = matchDocumentToSlot(entry.identity, entry.slots);
    totalMatchEvents++;
    if (result.decision === "auto_attached") {
      autoAttachedCount++;
    }
  }

  const rate =
    totalMatchEvents > 0
      ? ((autoAttachedCount / totalMatchEvents) * 100).toFixed(1)
      : "0.0";

  // Informational only — no assertion on the rate itself
  console.log(
    `[metricGuard] Auto-attach rate: ${rate}% (${autoAttachedCount}/${totalMatchEvents})`,
  );
});
