/**
 * Match Engine Orchestrator — Unit Tests
 *
 * End-to-end tests through the pure constraint engine.
 */

import test from "node:test";
import assert from "node:assert/strict";
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

// Standard slot set for golden-style tests
function makeStandardSlots(): SlotSnapshot[] {
  return [
    makeSlot({ slotId: "btr-2024", slotKey: "BTR_2024", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2024, sortOrder: 1 }),
    makeSlot({ slotId: "btr-2023", slotKey: "BTR_2023", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2023, sortOrder: 2 }),
    makeSlot({ slotId: "btr-2022", slotKey: "BTR_2022", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2022, sortOrder: 3 }),
    makeSlot({ slotId: "ptr-2024", slotKey: "PTR_2024", requiredDocType: "PERSONAL_TAX_RETURN", requiredTaxYear: 2024, sortOrder: 4 }),
    makeSlot({ slotId: "ptr-2023", slotKey: "PTR_2023", requiredDocType: "PERSONAL_TAX_RETURN", requiredTaxYear: 2023, sortOrder: 5 }),
    makeSlot({ slotId: "ptr-2022", slotKey: "PTR_2022", requiredDocType: "PERSONAL_TAX_RETURN", requiredTaxYear: 2022, sortOrder: 6 }),
    makeSlot({ slotId: "pfs-1", slotKey: "PFS_CURRENT", requiredDocType: "PERSONAL_FINANCIAL_STATEMENT", requiredTaxYear: null, sortOrder: 7 }),
    makeSlot({ slotId: "is-1", slotKey: "IS_YTD", requiredDocType: "INCOME_STATEMENT", requiredTaxYear: null, sortOrder: 8 }),
    makeSlot({ slotId: "bs-1", slotKey: "BS_YTD", requiredDocType: "BALANCE_SHEET", requiredTaxYear: null, sortOrder: 9 }),
    makeSlot({ slotId: "rr-1", slotKey: "RENT_ROLL", requiredDocType: "RENT_ROLL", requiredTaxYear: null, sortOrder: 10 }),
  ];
}

// ---------------------------------------------------------------------------
// Basic matching
// ---------------------------------------------------------------------------

test("MatchEngine: BTR 2024 → BTR_2024 slot", () => {
  const result = matchDocumentToSlot(
    makeIdentity({ effectiveDocType: "BUSINESS_TAX_RETURN", taxYear: 2024 }),
    makeStandardSlots(),
  );
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "btr-2024");
});

test("MatchEngine: PTR 2023 → PTR_2023 slot", () => {
  const result = matchDocumentToSlot(
    makeIdentity({ effectiveDocType: "PERSONAL_TAX_RETURN", rawDocType: "IRS_PERSONAL", taxYear: 2023, entityType: "personal" }),
    makeStandardSlots(),
  );
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "ptr-2023");
});

test("MatchEngine: IRS_BUSINESS 2022 → BTR_2022 slot", () => {
  const result = matchDocumentToSlot(
    makeIdentity({ effectiveDocType: "IRS_BUSINESS", taxYear: 2022 }),
    makeStandardSlots(),
  );
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "btr-2022");
});

// ---------------------------------------------------------------------------
// K-1 / W-2 routing (must NOT hit BTR)
// ---------------------------------------------------------------------------

test("MatchEngine: K-1 routes to PTR slot, not BTR", () => {
  const result = matchDocumentToSlot(
    makeIdentity({
      effectiveDocType: "PERSONAL_TAX_RETURN",
      rawDocType: "K1",
      taxYear: 2024,
      entityType: "personal",
    }),
    makeStandardSlots(),
  );
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "ptr-2024");
});

test("MatchEngine: W-2 routes to PTR slot, not BTR", () => {
  const result = matchDocumentToSlot(
    makeIdentity({
      effectiveDocType: "PERSONAL_TAX_RETURN",
      rawDocType: "W2",
      taxYear: 2024,
      entityType: "personal",
    }),
    makeStandardSlots(),
  );
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "ptr-2024");
});

// ---------------------------------------------------------------------------
// FINANCIAL_STATEMENT → review
// ---------------------------------------------------------------------------

test("MatchEngine: FINANCIAL_STATEMENT → routed_to_review (umbrella)", () => {
  const result = matchDocumentToSlot(
    makeIdentity({
      effectiveDocType: "FINANCIAL_STATEMENT",
      rawDocType: "FINANCIAL_STATEMENT",
      taxYear: null,
      entityType: null,
    }),
    makeStandardSlots(),
  );
  // Should be routed to review or no_match — never auto_attached
  assert.notEqual(result.decision, "auto_attached");
});

// ---------------------------------------------------------------------------
// PFS routing
// ---------------------------------------------------------------------------

test("MatchEngine: PFS → PFS_CURRENT slot", () => {
  const result = matchDocumentToSlot(
    makeIdentity({
      effectiveDocType: "PFS",
      rawDocType: "PFS",
      taxYear: null,
      entityType: "personal",
      authority: "probabilistic",
      confidence: 0.92,
    }),
    makeStandardSlots(),
  );
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "pfs-1");
});

// ---------------------------------------------------------------------------
// Income Statement / Balance Sheet
// ---------------------------------------------------------------------------

test("MatchEngine: INCOME_STATEMENT → IS slot", () => {
  const result = matchDocumentToSlot(
    makeIdentity({
      effectiveDocType: "INCOME_STATEMENT",
      rawDocType: "INCOME_STATEMENT",
      taxYear: null,
      entityType: null,
    }),
    makeStandardSlots(),
  );
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "is-1");
});

test("MatchEngine: BALANCE_SHEET → BS slot", () => {
  const result = matchDocumentToSlot(
    makeIdentity({
      effectiveDocType: "BALANCE_SHEET",
      rawDocType: "BALANCE_SHEET",
      taxYear: null,
      entityType: null,
    }),
    makeStandardSlots(),
  );
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "bs-1");
});

test("MatchEngine: T12 → IS slot", () => {
  const result = matchDocumentToSlot(
    makeIdentity({
      effectiveDocType: "T12",
      rawDocType: "T12",
      taxYear: null,
      entityType: null,
    }),
    makeStandardSlots(),
  );
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "is-1");
});

// ---------------------------------------------------------------------------
// Confidence gate rejections
// ---------------------------------------------------------------------------

test("MatchEngine: low confidence deterministic → routed_to_review", () => {
  const result = matchDocumentToSlot(
    makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      authority: "deterministic",
      confidence: 0.65,
    }),
    makeStandardSlots(),
  );
  assert.equal(result.decision, "routed_to_review");
});

test("MatchEngine: probabilistic at 0.83 → routed_to_review", () => {
  const result = matchDocumentToSlot(
    makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      authority: "probabilistic",
      confidence: 0.83,
    }),
    makeStandardSlots(),
  );
  assert.equal(result.decision, "routed_to_review");
});

// ---------------------------------------------------------------------------
// No match scenarios
// ---------------------------------------------------------------------------

test("MatchEngine: BTR with no year → no_match", () => {
  const result = matchDocumentToSlot(
    makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      taxYear: null,
    }),
    makeStandardSlots(),
  );
  // All BTR slots require a year, so no match
  assert.equal(result.decision, "no_match");
});

test("MatchEngine: OTHER doc type → no_match", () => {
  const result = matchDocumentToSlot(
    makeIdentity({
      effectiveDocType: "OTHER",
      rawDocType: "OTHER",
    }),
    makeStandardSlots(),
  );
  assert.equal(result.decision, "no_match");
});

test("MatchEngine: BTR when slot already filled → no_match", () => {
  const slots = makeStandardSlots().map((s) =>
    s.requiredDocType === "BUSINESS_TAX_RETURN" && s.requiredTaxYear === 2024
      ? { ...s, status: "attached" }
      : s,
  );
  const result = matchDocumentToSlot(
    makeIdentity({ effectiveDocType: "BUSINESS_TAX_RETURN", taxYear: 2024 }),
    slots,
  );
  // The 2024 slot is filled, but 2023 and 2022 don't match year → no_match
  assert.equal(result.decision, "no_match");
});

// ---------------------------------------------------------------------------
// Tie → routed_to_review
// ---------------------------------------------------------------------------

test("MatchEngine: two empty PFS slots → routed_to_review (tie)", () => {
  const slots = [
    makeSlot({ slotId: "pfs-1", slotKey: "PFS_CURRENT", requiredDocType: "PERSONAL_FINANCIAL_STATEMENT", requiredTaxYear: null, sortOrder: 1 }),
    makeSlot({ slotId: "pfs-2", slotKey: "PFS_BACKUP", requiredDocType: "PERSONAL_FINANCIAL_STATEMENT", requiredTaxYear: null, sortOrder: 2 }),
  ];
  const result = matchDocumentToSlot(
    makeIdentity({ effectiveDocType: "PFS", rawDocType: "PFS", taxYear: null, entityType: "personal" }),
    slots,
  );
  assert.equal(result.decision, "routed_to_review");
  assert.ok(result.reason.includes("tie"));
});

// ---------------------------------------------------------------------------
// Evidence always present
// ---------------------------------------------------------------------------

test("MatchEngine: evidence present on auto_attached", () => {
  const result = matchDocumentToSlot(
    makeIdentity(),
    makeStandardSlots(),
  );
  assert.equal(result.decision, "auto_attached");
  assert.ok(result.evidence);
  assert.equal(result.evidence!.engineVersion, "v1.1");
  assert.equal(result.evidence!.authority, "deterministic");
  assert.ok(result.evidence!.constraintsSatisfied.length > 0);
  assert.ok(result.evidence!.negativeRulesEvaluated.length > 0);
});

test("MatchEngine: evidence present on routed_to_review", () => {
  const result = matchDocumentToSlot(
    makeIdentity({ authority: "deterministic", confidence: 0.65 }),
    makeStandardSlots(),
  );
  assert.equal(result.decision, "routed_to_review");
  assert.ok(result.evidence);
  assert.equal(result.evidence!.engineVersion, "v1.1");
});

test("MatchEngine: evidence present on no_match", () => {
  const result = matchDocumentToSlot(
    makeIdentity({ effectiveDocType: "OTHER" }),
    makeStandardSlots(),
  );
  assert.equal(result.decision, "no_match");
  assert.ok(result.evidence);
});

test("MatchEngine: slotPolicyVersion stamped in evidence", () => {
  const result = matchDocumentToSlot(
    makeIdentity(),
    makeStandardSlots(),
    "conventional_v3",
  );
  assert.equal(result.evidence!.slotPolicyVersion, "conventional_v3");
});

// ---------------------------------------------------------------------------
// Manual authority always passes gate
// ---------------------------------------------------------------------------

test("MatchEngine: manual authority always auto-attaches", () => {
  const result = matchDocumentToSlot(
    makeIdentity({
      authority: "manual",
      confidence: 1.0,
      classificationEvidence: [],
    }),
    makeStandardSlots(),
  );
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "btr-2024");
});

// ---------------------------------------------------------------------------
// Cross-contamination checks
// ---------------------------------------------------------------------------

test("MatchEngine: PFS cannot reach IS slot", () => {
  const slots = [
    makeSlot({ slotId: "is-1", slotKey: "IS_YTD", requiredDocType: "INCOME_STATEMENT", requiredTaxYear: null }),
  ];
  const result = matchDocumentToSlot(
    makeIdentity({ effectiveDocType: "PFS", rawDocType: "PFS", taxYear: null, entityType: "personal" }),
    slots,
  );
  assert.equal(result.decision, "no_match");
});

test("MatchEngine: BTR cannot reach PTR slot", () => {
  const slots = [
    makeSlot({ slotId: "ptr-2024", slotKey: "PTR_2024", requiredDocType: "PERSONAL_TAX_RETURN", requiredTaxYear: 2024 }),
  ];
  const result = matchDocumentToSlot(
    makeIdentity({ effectiveDocType: "BUSINESS_TAX_RETURN", taxYear: 2024, entityType: "business" }),
    slots,
  );
  assert.equal(result.decision, "no_match");
});

test("MatchEngine: empty slot array → no_match", () => {
  const result = matchDocumentToSlot(makeIdentity(), []);
  assert.equal(result.decision, "no_match");
});
