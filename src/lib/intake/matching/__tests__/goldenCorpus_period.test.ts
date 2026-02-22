/**
 * Golden Corpus — Period Extraction Match Invariants (v1.3)
 *
 * Validates period-aware year matching:
 *   - Period fallback when doc_year is null
 *   - Year conflict detection (doc_year ≠ period end year)
 *   - Multi-year span blocking
 *   - Fiscal year entity period handling
 *
 * Pure function tests — no DB, no IO, no side effects.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { matchDocumentToSlot } from "../matchEngine";
import type { DocumentIdentity, SlotSnapshot, PeriodInfo } from "../types";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function makeIdentity(overrides: Partial<DocumentIdentity>): DocumentIdentity {
  return {
    documentId: "period-golden-doc",
    effectiveDocType: "OTHER",
    rawDocType: "OTHER",
    taxYear: null,
    entityType: null,
    formNumbers: null,
    authority: "deterministic",
    confidence: 0.97,
    classificationEvidence: [
      { type: "form_match", anchorId: "period-golden", matchedText: "test", confidence: 0.97 },
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

function makePeriod(overrides: Partial<PeriodInfo>): PeriodInfo {
  return {
    periodStart: null,
    periodEnd: null,
    statementType: "annual",
    multiYear: false,
    taxYearConfidence: 0.90,
    ...overrides,
  };
}

function standardYearSlots(): SlotSnapshot[] {
  return [
    makeSlot({ slotId: "btr-2024", slotKey: "BTR_2024", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2024, slotGroup: "tax", sortOrder: 1 }),
    makeSlot({ slotId: "btr-2023", slotKey: "BTR_2023", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2023, slotGroup: "tax", sortOrder: 2 }),
    makeSlot({ slotId: "ptr-2024", slotKey: "PTR_2024", requiredDocType: "PERSONAL_TAX_RETURN", requiredTaxYear: 2024, slotGroup: "tax", sortOrder: 3 }),
    makeSlot({ slotId: "ptr-2023", slotKey: "PTR_2023", requiredDocType: "PERSONAL_TAX_RETURN", requiredTaxYear: 2023, slotGroup: "tax", sortOrder: 4 }),
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

const PERIOD_GOLDEN_CORPUS: GoldenEntry[] = [
  // ── P1: Year conflict — doc_year 2024 but period says 2023 ─────────────
  {
    label: "#P1: Year conflict (doc_year=2024, period end=2023) → no_match (conflict blocks)",
    identity: makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      rawDocType: "IRS_BUSINESS",
      taxYear: 2024,
      entityType: "business",
      period: makePeriod({
        periodStart: "2023-01-01",
        periodEnd: "2023-12-31",
        statementType: "annual",
      }),
    }),
    slots: standardYearSlots(),
    // Year conflict constraint fires: doc_year 2024 ≠ period end year 2023
    // Even though doc_year 2024 matches BTR_2024 slot year, year_conflict blocks it
    expectedDecision: "no_match",
    expectedSlotId: null,
  },

  // ── P2: Multi-year bank statement spans 2023-2024 ─────────────────────
  {
    label: "#P2: Multi-year document (2023-2024) → no_match (checkNotMultiYear blocks)",
    identity: makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      rawDocType: "IRS_BUSINESS",
      taxYear: 2024,
      entityType: "business",
      period: makePeriod({
        periodStart: "2023-01-01",
        periodEnd: "2024-12-31",
        multiYear: true,
      }),
    }),
    slots: standardYearSlots(),
    expectedDecision: "no_match",
    expectedSlotId: null,
  },

  // ── P3: 18-month P&L (July 2022 - Dec 2023) ──────────────────────────
  {
    label: "#P3: 18-month multi-year period → no_match (multiYear=true blocks)",
    identity: makeIdentity({
      effectiveDocType: "PERSONAL_TAX_RETURN",
      rawDocType: "IRS_PERSONAL",
      taxYear: 2023,
      entityType: "personal",
      period: makePeriod({
        periodStart: "2022-07-01",
        periodEnd: "2023-12-31",
        multiYear: true,
      }),
    }),
    slots: standardYearSlots(),
    expectedDecision: "no_match",
    expectedSlotId: null,
  },

  // ── P4: Fiscal year entity (April 2023 - March 2024) ─────────────────
  {
    label: "#P4: Fiscal year entity (Apr 2023–Mar 2024, doc_year null) → routed_to_review (ties: start=2023, end=2024)",
    identity: makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      rawDocType: "IRS_BUSINESS",
      taxYear: null, // no doc_year extracted
      entityType: "business",
      period: makePeriod({
        periodStart: "2023-04-01",
        periodEnd: "2024-03-31",
        statementType: "annual",
        multiYear: false, // fiscal year is NOT multi-year
      }),
    }),
    slots: standardYearSlots(),
    // Period fallback: startYear=2023 matches BTR_2023, endYear=2024 matches BTR_2024
    // Two candidates → tie → routed_to_review (safe — never guess on fiscal year)
    expectedDecision: "routed_to_review",
    expectedSlotId: null,
  },

  // ── P5: Standard annual return — strict match still works ─────────────
  {
    label: "#P5: Standard annual BTR 2023 → BTR_2023 (strict match, no period needed)",
    identity: makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      rawDocType: "IRS_BUSINESS",
      taxYear: 2023,
      entityType: "business",
    }),
    slots: standardYearSlots(),
    expectedDecision: "auto_attached",
    expectedSlotId: "btr-2023",
  },

  // ── P6: Period end year matches but doc_year null — fallback works ────
  {
    label: "#P6: doc_year null + period end 2023 → PTR_2023 via period fallback",
    identity: makeIdentity({
      effectiveDocType: "PERSONAL_TAX_RETURN",
      rawDocType: "IRS_PERSONAL",
      taxYear: null,
      entityType: "personal",
      period: makePeriod({
        periodStart: "2023-01-01",
        periodEnd: "2023-12-31",
        statementType: "annual",
      }),
    }),
    slots: standardYearSlots(),
    expectedDecision: "auto_attached",
    expectedSlotId: "ptr-2023",
  },

  // ── P7: Low year confidence → no_match ────────────────────────────────
  {
    label: "#P7: Low year confidence (0.40) → no_match (year_confidence_sufficient blocks)",
    identity: makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      rawDocType: "IRS_BUSINESS",
      taxYear: 2024,
      entityType: "business",
      period: makePeriod({
        periodStart: "2024-01-01",
        periodEnd: "2024-12-31",
        taxYearConfidence: 0.40,
      }),
    }),
    slots: standardYearSlots(),
    expectedDecision: "no_match",
    expectedSlotId: null,
  },

  // ── P8: Consistent year + period (no conflict) → auto_attached ────────
  {
    label: "#P8: Consistent doc_year=2024 + period end 2024 → BTR_2024 (no conflict)",
    identity: makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      rawDocType: "IRS_BUSINESS",
      taxYear: 2024,
      entityType: "business",
      period: makePeriod({
        periodStart: "2024-01-01",
        periodEnd: "2024-12-31",
        statementType: "annual",
      }),
    }),
    slots: standardYearSlots(),
    expectedDecision: "auto_attached",
    expectedSlotId: "btr-2024",
  },
];

// ---------------------------------------------------------------------------
// Test: each golden entry
// ---------------------------------------------------------------------------

for (const entry of PERIOD_GOLDEN_CORPUS) {
  test(`Period Golden ${entry.label}`, () => {
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

test("Period Golden Corpus: wrongAttachCount == 0", () => {
  let wrongAttachCount = 0;
  const wrongAttaches: string[] = [];

  for (const entry of PERIOD_GOLDEN_CORPUS) {
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
    console.error("[periodGolden] Wrong attaches:\n" + wrongAttaches.join("\n"));
  }

  assert.strictEqual(
    wrongAttachCount,
    0,
    `Period golden corpus: wrongAttachCount must be 0, got ${wrongAttachCount}`,
  );

  console.log(
    `[periodGolden] wrongAttachCount == 0 across ${PERIOD_GOLDEN_CORPUS.length} period corpus entries ✓`,
  );
});
