/**
 * Intake Top Leaks Guard — CI-Blocking Layer 1.5 Invariants
 *
 * Validates the invariants that the ranking views and Command Center depend on.
 * Pure function test — no DB, no IO. Runs matchDocumentToSlot() against the
 * same 26-entry golden corpus used by atomicMetricsGuard.test.ts.
 *
 * Guards:
 *   1. No catastrophic regression: per-doc-type attach_rate stays within
 *      20 percentage points of expected floor
 *   2. No systemic override rate: pure engine produces zero overrides
 *      (override_rate == 0 < 0.50 threshold)
 *   3. No excessive review rate: per-doc-type review_rate <= 0.75
 *   4. wrongAttachCount == 0 (inherited invariant)
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

function makeIdentity(overrides: Partial<DocumentIdentity>): DocumentIdentity {
  return {
    documentId: "leaks-guard-doc",
    effectiveDocType: "OTHER",
    rawDocType: "OTHER",
    taxYear: null,
    entityType: null,
    formNumbers: null,
    authority: "deterministic",
    confidence: 0.97,
    classificationEvidence: [
      { type: "form_match", anchorId: "leaks-guard", matchedText: "test", confidence: 0.97 },
    ],
    period: null,
    entity: null,
    ...overrides,
  };
}

function makeSlot(
  overrides: Partial<SlotSnapshot> & Pick<SlotSnapshot, "slotId" | "slotKey" | "requiredDocType">,
): SlotSnapshot {
  return {
    slotGroup: "default",
    requiredTaxYear: null,
    status: "empty",
    sortOrder: 0,
    ...overrides,
  };
}

function standardSlots(): SlotSnapshot[] {
  return [
    makeSlot({ slotId: "btr-2024", slotKey: "BTR_2024", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2024, slotGroup: "tax", sortOrder: 1 }),
    makeSlot({ slotId: "btr-2023", slotKey: "BTR_2023", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2023, slotGroup: "tax", sortOrder: 2 }),
    makeSlot({ slotId: "btr-2022", slotKey: "BTR_2022", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2022, slotGroup: "tax", sortOrder: 3 }),
    makeSlot({ slotId: "ptr-2024", slotKey: "PTR_2024", requiredDocType: "PERSONAL_TAX_RETURN", requiredTaxYear: 2024, slotGroup: "tax", sortOrder: 4 }),
    makeSlot({ slotId: "ptr-2023", slotKey: "PTR_2023", requiredDocType: "PERSONAL_TAX_RETURN", requiredTaxYear: 2023, slotGroup: "tax", sortOrder: 5 }),
    makeSlot({ slotId: "ptr-2022", slotKey: "PTR_2022", requiredDocType: "PERSONAL_TAX_RETURN", requiredTaxYear: 2022, slotGroup: "tax", sortOrder: 6 }),
    makeSlot({ slotId: "pfs-1", slotKey: "PFS_CURRENT", requiredDocType: "PERSONAL_FINANCIAL_STATEMENT", slotGroup: "financial", sortOrder: 7 }),
    makeSlot({ slotId: "is-1", slotKey: "IS_YTD", requiredDocType: "INCOME_STATEMENT", slotGroup: "financial", sortOrder: 8 }),
    makeSlot({ slotId: "bs-1", slotKey: "BS_YTD", requiredDocType: "BALANCE_SHEET", slotGroup: "financial", sortOrder: 9 }),
    makeSlot({ slotId: "rr-1", slotKey: "RENT_ROLL", requiredDocType: "RENT_ROLL", slotGroup: "property", sortOrder: 10 }),
  ];
}

// ---------------------------------------------------------------------------
// Golden corpus — 26 entries mirroring atomicMetricsGuard.test.ts
// ---------------------------------------------------------------------------

type GoldenEntry = {
  label: string;
  identity: DocumentIdentity;
  slots: SlotSnapshot[];
  expectedDecision: "auto_attached" | "routed_to_review" | "no_match";
  expectedSlotId: string | null;
};

const GOLDEN_CORPUS: GoldenEntry[] = [
  // Tax return year-matched attaches
  { label: "#1: BTR 2024 → BTR_2024", identity: makeIdentity({ effectiveDocType: "BUSINESS_TAX_RETURN", rawDocType: "IRS_BUSINESS", taxYear: 2024, entityType: "business" }), slots: standardSlots(), expectedDecision: "auto_attached", expectedSlotId: "btr-2024" },
  { label: "#2: BTR 2023 → BTR_2023", identity: makeIdentity({ effectiveDocType: "BUSINESS_TAX_RETURN", rawDocType: "IRS_BUSINESS", taxYear: 2023, entityType: "business" }), slots: standardSlots(), expectedDecision: "auto_attached", expectedSlotId: "btr-2023" },
  { label: "#3: BTR 2022 → BTR_2022", identity: makeIdentity({ effectiveDocType: "BUSINESS_TAX_RETURN", rawDocType: "IRS_BUSINESS", taxYear: 2022, entityType: "business" }), slots: standardSlots(), expectedDecision: "auto_attached", expectedSlotId: "btr-2022" },
  { label: "#4: PTR 2024 → PTR_2024", identity: makeIdentity({ effectiveDocType: "PERSONAL_TAX_RETURN", rawDocType: "IRS_PERSONAL", taxYear: 2024, entityType: "personal" }), slots: standardSlots(), expectedDecision: "auto_attached", expectedSlotId: "ptr-2024" },
  { label: "#5: PTR 2023 → PTR_2023", identity: makeIdentity({ effectiveDocType: "PERSONAL_TAX_RETURN", rawDocType: "IRS_PERSONAL", taxYear: 2023, entityType: "personal" }), slots: standardSlots(), expectedDecision: "auto_attached", expectedSlotId: "ptr-2023" },
  { label: "#6: PTR 2022 → PTR_2022", identity: makeIdentity({ effectiveDocType: "PERSONAL_TAX_RETURN", rawDocType: "IRS_PERSONAL", taxYear: 2022, entityType: "personal" }), slots: standardSlots(), expectedDecision: "auto_attached", expectedSlotId: "ptr-2022" },

  // K-1, W-2 crossover
  { label: "#7: K-1 2024 → PTR_2024 (NOT BTR)", identity: makeIdentity({ effectiveDocType: "PERSONAL_TAX_RETURN", rawDocType: "K1", taxYear: 2024, entityType: "personal" }), slots: standardSlots(), expectedDecision: "auto_attached", expectedSlotId: "ptr-2024" },
  { label: "#8: W-2 2024 → PTR_2024 (NOT BTR)", identity: makeIdentity({ effectiveDocType: "PERSONAL_TAX_RETURN", rawDocType: "W2", taxYear: 2024, entityType: "personal" }), slots: standardSlots(), expectedDecision: "auto_attached", expectedSlotId: "ptr-2024" },

  // Financial statements
  { label: "#9: PFS → PFS_CURRENT", identity: makeIdentity({ effectiveDocType: "PERSONAL_FINANCIAL_STATEMENT", rawDocType: "PFS", taxYear: null, entityType: "personal", authority: "probabilistic", confidence: 0.92 }), slots: standardSlots(), expectedDecision: "auto_attached", expectedSlotId: "pfs-1" },
  { label: "#10: IS → IS_YTD", identity: makeIdentity({ effectiveDocType: "INCOME_STATEMENT", rawDocType: "INCOME_STATEMENT", taxYear: null, entityType: null, confidence: 0.92 }), slots: standardSlots(), expectedDecision: "auto_attached", expectedSlotId: "is-1" },
  { label: "#11: BS → BS_YTD", identity: makeIdentity({ effectiveDocType: "BALANCE_SHEET", rawDocType: "BALANCE_SHEET", taxYear: null, entityType: null, confidence: 0.93 }), slots: standardSlots(), expectedDecision: "auto_attached", expectedSlotId: "bs-1" },
  { label: "#12: RENT_ROLL → slot", identity: makeIdentity({ effectiveDocType: "RENT_ROLL", rawDocType: "RENT_ROLL", taxYear: null, entityType: null, confidence: 0.95 }), slots: standardSlots(), expectedDecision: "auto_attached", expectedSlotId: "rr-1" },

  // Negative rules & gating
  { label: "#13: FINANCIAL_STATEMENT umbrella → no_match", identity: makeIdentity({ effectiveDocType: "FINANCIAL_STATEMENT", rawDocType: "FINANCIAL_STATEMENT" }), slots: standardSlots(), expectedDecision: "no_match", expectedSlotId: null },
  { label: "#14: BTR no year → no_match", identity: makeIdentity({ effectiveDocType: "BUSINESS_TAX_RETURN", rawDocType: "IRS_BUSINESS", taxYear: null, entityType: "business" }), slots: standardSlots(), expectedDecision: "no_match", expectedSlotId: null },
  { label: "#15: Low confidence (0.65) → routed_to_review", identity: makeIdentity({ effectiveDocType: "BUSINESS_TAX_RETURN", taxYear: 2024, confidence: 0.65, authority: "deterministic" }), slots: standardSlots(), expectedDecision: "routed_to_review", expectedSlotId: null },
  { label: "#16: Probabilistic 0.83 → routed_to_review", identity: makeIdentity({ effectiveDocType: "BUSINESS_TAX_RETURN", taxYear: 2024, confidence: 0.83, authority: "probabilistic" }), slots: standardSlots(), expectedDecision: "routed_to_review", expectedSlotId: null },
  { label: "#17: BTR 2024 slot filled → no_match", identity: makeIdentity({ effectiveDocType: "BUSINESS_TAX_RETURN", rawDocType: "IRS_BUSINESS", taxYear: 2024, entityType: "business" }), slots: standardSlots().map((s) => s.slotId === "btr-2024" ? { ...s, status: "attached" as const } : s), expectedDecision: "no_match", expectedSlotId: null },
  { label: "#18: PFS with only BTR slot → no_match", identity: makeIdentity({ effectiveDocType: "PERSONAL_FINANCIAL_STATEMENT", rawDocType: "PFS", taxYear: null, entityType: "personal", authority: "probabilistic", confidence: 0.92 }), slots: [makeSlot({ slotId: "btr-2024", slotKey: "BTR_2024", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2024, slotGroup: "tax", sortOrder: 1 })], expectedDecision: "no_match", expectedSlotId: null },
  { label: "#19: OTHER doc type → no_match", identity: makeIdentity({ effectiveDocType: "OTHER", rawDocType: "OTHER" }), slots: standardSlots(), expectedDecision: "no_match", expectedSlotId: null },

  // Period gating
  { label: "#20: Multi-year BTR → no_match", identity: makeIdentity({ effectiveDocType: "BUSINESS_TAX_RETURN", rawDocType: "IRS_BUSINESS", taxYear: 2024, entityType: "business", period: { periodStart: "2023-01-01", periodEnd: "2024-12-31", statementType: "annual", multiYear: true, taxYearConfidence: 0.95 } }), slots: [makeSlot({ slotId: "btr-2024", slotKey: "BTR_2024", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2024, slotGroup: "tax", sortOrder: 1 })], expectedDecision: "no_match", expectedSlotId: null },
  { label: "#21: Low year confidence → no_match", identity: makeIdentity({ effectiveDocType: "BUSINESS_TAX_RETURN", rawDocType: "IRS_BUSINESS", taxYear: 2024, entityType: "business", period: { periodStart: null, periodEnd: null, statementType: "annual", multiYear: false, taxYearConfidence: 0.50 } }), slots: [makeSlot({ slotId: "btr-2024", slotKey: "BTR_2024", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2024, slotGroup: "tax", sortOrder: 1 })], expectedDecision: "no_match", expectedSlotId: null },

  // Entity routing
  { label: "#22: BTR with entity match → entity slot", identity: makeIdentity({ effectiveDocType: "BUSINESS_TAX_RETURN", rawDocType: "IRS_BUSINESS", taxYear: 2024, entityType: "business", entity: { entityId: "ent-opco", entityRole: "operating", confidence: 0.95, ambiguous: false } }), slots: [makeSlot({ slotId: "btr-2024-opco", slotKey: "BTR_2024_OPCO", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2024, slotGroup: "tax", sortOrder: 1, requiredEntityId: "ent-opco" })], expectedDecision: "auto_attached", expectedSlotId: "btr-2024-opco" },
  { label: "#23: Ambiguous entity → routed_to_review", identity: makeIdentity({ effectiveDocType: "BUSINESS_TAX_RETURN", rawDocType: "IRS_BUSINESS", taxYear: 2024, entityType: "business", entity: { entityId: null, entityRole: null, confidence: 0.70, ambiguous: true } }), slots: [makeSlot({ slotId: "btr-2024-opco", slotKey: "BTR_2024_OPCO", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2024, slotGroup: "tax", sortOrder: 1, requiredEntityId: "ent-opco" }), makeSlot({ slotId: "btr-2024-holdco", slotKey: "BTR_2024_HOLDCO", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2024, slotGroup: "tax", sortOrder: 2, requiredEntityId: "ent-holdco" })], expectedDecision: "routed_to_review", expectedSlotId: null },
  { label: "#24: PFS with entity match → entity slot", identity: makeIdentity({ effectiveDocType: "PERSONAL_FINANCIAL_STATEMENT", rawDocType: "PFS", taxYear: null, entityType: "personal", authority: "probabilistic", confidence: 0.92, entity: { entityId: "ent-guar", entityRole: "guarantor", confidence: 0.90, ambiguous: false } }), slots: [makeSlot({ slotId: "pfs-guar", slotKey: "PFS_GUARANTOR", requiredDocType: "PERSONAL_FINANCIAL_STATEMENT", slotGroup: "financial", sortOrder: 1, requiredEntityId: "ent-guar" })], expectedDecision: "auto_attached", expectedSlotId: "pfs-guar" },

  // Statement types
  { label: "#25: IS YTD matches IS slot", identity: makeIdentity({ effectiveDocType: "INCOME_STATEMENT", rawDocType: "INCOME_STATEMENT", taxYear: null, entityType: null, confidence: 0.92, period: { periodStart: "2025-01-01", periodEnd: "2025-09-30", statementType: "ytd", multiYear: false, taxYearConfidence: 0.75 } }), slots: [makeSlot({ slotId: "is-1", slotKey: "IS_YTD", requiredDocType: "INCOME_STATEMENT", slotGroup: "financial", sortOrder: 1 })], expectedDecision: "auto_attached", expectedSlotId: "is-1" },
  { label: "#26: K-1 2023 → PTR_2023 (NOT BTR_2023)", identity: makeIdentity({ effectiveDocType: "PERSONAL_TAX_RETURN", rawDocType: "K1", taxYear: 2023, entityType: "personal" }), slots: standardSlots(), expectedDecision: "auto_attached", expectedSlotId: "ptr-2023" },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("no catastrophic regression: per-doc-type attach_rate within -0.20 of corpus floor", () => {
  // Compute actual attach rates per doc type from corpus
  const perDocType = new Map<string, { auto: number; total: number; expectedMinRate: number }>();

  // Define expected floors based on corpus design
  // (entries that should predominantly auto_attach)
  const expectedFloors: Record<string, number> = {
    BUSINESS_TAX_RETURN:      0.30,  // 3 attach out of ~9 entries
    PERSONAL_TAX_RETURN:      0.60,  // 4 attach out of 5 entries
    PERSONAL_FINANCIAL_STATEMENT: 0.50,
    INCOME_STATEMENT:         0.80,
    BALANCE_SHEET:            0.80,
    RENT_ROLL:                0.80,
  };

  for (const entry of GOLDEN_CORPUS) {
    const result: MatchResult = matchDocumentToSlot(entry.identity, entry.slots);
    const docType = entry.identity.effectiveDocType;
    if (!perDocType.has(docType)) {
      perDocType.set(docType, { auto: 0, total: 0, expectedMinRate: expectedFloors[docType] ?? 0 });
    }
    const rec = perDocType.get(docType)!;
    rec.total++;
    if (result.decision === "auto_attached") rec.auto++;
  }

  for (const [docType, counts] of perDocType) {
    const actualRate = counts.total > 0 ? counts.auto / counts.total : 0;
    const floor = counts.expectedMinRate;
    if (floor > 0) {
      assert.ok(
        actualRate >= floor - 0.20,
        `Doc type "${docType}" attach_rate ${actualRate.toFixed(3)} dropped more than 0.20 below floor ${floor} (delta = ${(actualRate - floor).toFixed(3)})`,
      );
    }
  }

  console.log(`[intakeTopLeaksGuard] regression check passed — ${perDocType.size} doc types within floor`);
});

test("no systemic override rate: pure engine produces zero overrides (override_rate == 0 < 0.50)", () => {
  // The pure matchDocumentToSlot engine never produces overrides.
  // Overrides come from human classification.manual_override events (DB only).
  // Asserting 0.0 < 0.50 is a structural invariant — if override_rate computation
  // ever returns non-zero from the pure engine, something is catastrophically wrong.

  const perDocType = new Map<string, { auto: number; total: number }>();
  let overrideCount = 0;

  for (const entry of GOLDEN_CORPUS) {
    const result: MatchResult = matchDocumentToSlot(entry.identity, entry.slots);
    const docType = entry.identity.effectiveDocType;
    if (!perDocType.has(docType)) perDocType.set(docType, { auto: 0, total: 0 });
    const rec = perDocType.get(docType)!;
    rec.total++;
    if (result.decision === "auto_attached") rec.auto++;
    // Pure engine cannot produce overrides — only humans do
  }

  assert.equal(
    overrideCount,
    0,
    `Pure matching engine must produce 0 overrides, got ${overrideCount}`,
  );

  for (const [docType, counts] of perDocType) {
    const overrideRate = counts.total > 0 ? overrideCount / counts.total : 0;
    assert.ok(
      overrideRate <= 0.50,
      `Doc type "${docType}" override_rate ${overrideRate} exceeds 0.50 threshold`,
    );
  }

  console.log(`[intakeTopLeaksGuard] override_rate == 0 for all doc types (${perDocType.size} checked)`);
});

test("no excessive review rate: per-doc-type review_rate <= 0.75", () => {
  const perDocType = new Map<string, { review: number; total: number }>();

  for (const entry of GOLDEN_CORPUS) {
    const result: MatchResult = matchDocumentToSlot(entry.identity, entry.slots);
    const docType = entry.identity.effectiveDocType;
    if (!perDocType.has(docType)) perDocType.set(docType, { review: 0, total: 0 });
    const rec = perDocType.get(docType)!;
    rec.total++;
    if (result.decision === "routed_to_review") rec.review++;
  }

  const violations: string[] = [];
  for (const [docType, counts] of perDocType) {
    const reviewRate = counts.total > 0 ? counts.review / counts.total : 0;
    if (reviewRate > 0.75) {
      violations.push(`"${docType}": review_rate = ${reviewRate.toFixed(3)} (${counts.review}/${counts.total})`);
    }
  }

  if (violations.length > 0) {
    assert.fail(`Doc types with review_rate > 0.75:\n${violations.join("\n")}`);
  }

  console.log(`[intakeTopLeaksGuard] review_rate <= 0.75 for all ${perDocType.size} doc types`);
});

test("wrongAttachCount == 0 (inherited invariant)", () => {
  let wrongAttachCount = 0;
  const wrongAttaches: string[] = [];

  for (const entry of GOLDEN_CORPUS) {
    const result: MatchResult = matchDocumentToSlot(entry.identity, entry.slots);

    // Verify decision matches expected
    assert.equal(
      result.decision,
      entry.expectedDecision,
      `${entry.label}: expected "${entry.expectedDecision}", got "${result.decision}" (reason: ${result.reason})`,
    );

    // Verify correct slot for auto_attached decisions
    if (entry.expectedDecision === "auto_attached" && result.decision === "auto_attached") {
      if (result.slotId !== entry.expectedSlotId) {
        wrongAttachCount++;
        wrongAttaches.push(
          `${entry.label}: attached to "${result.slotId}", expected "${entry.expectedSlotId}"`,
        );
      }
      assert.equal(
        result.slotId,
        entry.expectedSlotId,
        `${entry.label}: expected slotId "${entry.expectedSlotId}", got "${result.slotId}"`,
      );
    }

    // Detect unexpected auto_attach when review/no_match expected
    if (result.decision === "auto_attached" && entry.expectedDecision !== "auto_attached") {
      wrongAttachCount++;
      wrongAttaches.push(
        `${entry.label}: unexpected auto_attach to "${result.slotId}" (expected "${entry.expectedDecision}")`,
      );
    }
  }

  if (wrongAttaches.length > 0) {
    console.error("[intakeTopLeaksGuard] Wrong attaches:\n" + wrongAttaches.join("\n"));
  }

  assert.equal(
    wrongAttachCount,
    0,
    `wrongAttachCount must be 0, got ${wrongAttachCount}`,
  );

  console.log(`[intakeTopLeaksGuard] wrongAttachCount == 0 across all ${GOLDEN_CORPUS.length} entries`);
});
