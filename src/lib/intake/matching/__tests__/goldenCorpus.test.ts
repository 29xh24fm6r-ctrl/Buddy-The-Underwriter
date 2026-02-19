/**
 * Golden Corpus — CI-Blocking Match Invariants
 *
 * Every golden entry runs through matchDocumentToSlot().
 * Wrong-attach count must equal 0.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { matchDocumentToSlot } from "../matchEngine";
import type { DocumentIdentity, SlotSnapshot } from "../types";

// ---------------------------------------------------------------------------
// Slot set — realistic conventional policy
// ---------------------------------------------------------------------------

function makeSlot(overrides: Partial<SlotSnapshot> & Pick<SlotSnapshot, "slotId" | "slotKey" | "requiredDocType">): SlotSnapshot {
  return {
    slotGroup: "default",
    requiredTaxYear: null,
    status: "empty",
    sortOrder: 0,
    ...overrides,
  };
}

function goldenSlots(): SlotSnapshot[] {
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
// Identity builder
// ---------------------------------------------------------------------------

function makeIdentity(overrides: Partial<DocumentIdentity>): DocumentIdentity {
  return {
    documentId: "golden-doc",
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
// Golden corpus: 0% wrong-attach CI invariant
// ---------------------------------------------------------------------------

// #1: BTR 2024 (deterministic, 0.97) → BTR_2024 slot
test("Golden #1: BTR 2024 → BUSINESS_TAX_RETURN_2024 slot", () => {
  const result = matchDocumentToSlot(
    makeIdentity({ effectiveDocType: "BUSINESS_TAX_RETURN", rawDocType: "IRS_BUSINESS", taxYear: 2024, entityType: "business" }),
    goldenSlots(),
  );
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "btr-2024");
});

// #2: PTR 2023 (deterministic, 0.97) → PTR_2023 slot
test("Golden #2: PTR 2023 → PERSONAL_TAX_RETURN_2023 slot", () => {
  const result = matchDocumentToSlot(
    makeIdentity({ effectiveDocType: "PERSONAL_TAX_RETURN", rawDocType: "IRS_PERSONAL", taxYear: 2023, entityType: "personal" }),
    goldenSlots(),
  );
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "ptr-2023");
});

// #3: K-1 2024 (effective=PTR, deterministic) → PTR_2024 (NOT BTR)
test("Golden #3: K-1 2024 → PTR_2024 (NOT BTR)", () => {
  const result = matchDocumentToSlot(
    makeIdentity({ effectiveDocType: "PERSONAL_TAX_RETURN", rawDocType: "K1", taxYear: 2024, entityType: "personal" }),
    goldenSlots(),
  );
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "ptr-2024");
  assert.notEqual(result.slotId as string, "btr-2024", "K-1 must NOT reach BTR slot");
});

// #4: W-2 2024 (effective=PTR, deterministic) → PTR_2024 (NOT BTR)
test("Golden #4: W-2 2024 → PTR_2024 (NOT BTR)", () => {
  const result = matchDocumentToSlot(
    makeIdentity({ effectiveDocType: "PERSONAL_TAX_RETURN", rawDocType: "W2", taxYear: 2024, entityType: "personal" }),
    goldenSlots(),
  );
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "ptr-2024");
  assert.notEqual(result.slotId as string, "btr-2024", "W-2 must NOT reach BTR slot");
});

// #5: PFS (probabilistic, 0.92) → PFS_CURRENT (NOT BS, NOT IS)
test("Golden #5: PFS → PFS_CURRENT", () => {
  const result = matchDocumentToSlot(
    makeIdentity({ effectiveDocType: "PFS", rawDocType: "PFS", taxYear: null, entityType: "personal", authority: "probabilistic", confidence: 0.92 }),
    goldenSlots(),
  );
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "pfs-1");
  assert.notEqual(result.slotId as string, "is-1", "PFS must NOT reach IS slot");
  assert.notEqual(result.slotId as string, "bs-1", "PFS must NOT reach BS slot");
});

// #6: FINANCIAL_STATEMENT (umbrella) → routed_to_review (never auto-resolves)
test("Golden #6: FINANCIAL_STATEMENT → never auto_attached", () => {
  const result = matchDocumentToSlot(
    makeIdentity({ effectiveDocType: "FINANCIAL_STATEMENT", rawDocType: "FINANCIAL_STATEMENT", taxYear: null, entityType: null }),
    goldenSlots(),
  );
  assert.notEqual(result.decision, "auto_attached",
    "FINANCIAL_STATEMENT must NEVER auto-attach");
});

// #7: INCOME_STATEMENT (deterministic, 0.92) → IS slot (NOT BS)
test("Golden #7: INCOME_STATEMENT → IS_YTD slot", () => {
  const result = matchDocumentToSlot(
    makeIdentity({ effectiveDocType: "INCOME_STATEMENT", rawDocType: "INCOME_STATEMENT", taxYear: null, entityType: null, confidence: 0.92 }),
    goldenSlots(),
  );
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "is-1");
  assert.notEqual(result.slotId as string, "bs-1", "IS must NOT reach BS slot");
});

// #8: BALANCE_SHEET (deterministic, 0.93) → BS slot (NOT IS)
test("Golden #8: BALANCE_SHEET → BS_YTD slot", () => {
  const result = matchDocumentToSlot(
    makeIdentity({ effectiveDocType: "BALANCE_SHEET", rawDocType: "BALANCE_SHEET", taxYear: null, entityType: null, confidence: 0.93 }),
    goldenSlots(),
  );
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "bs-1");
  assert.notEqual(result.slotId as string, "is-1", "BS must NOT reach IS slot");
});

// #9: BTR no year → no_match (negative rule: NO_YEAR_NO_YEAR_SLOT)
test("Golden #9: BTR no year → no_match", () => {
  const result = matchDocumentToSlot(
    makeIdentity({ effectiveDocType: "BUSINESS_TAX_RETURN", rawDocType: "IRS_BUSINESS", taxYear: null, entityType: "business" }),
    goldenSlots(),
  );
  assert.equal(result.decision, "no_match");
});

// #10: Low confidence (0.65, deterministic) → routed_to_review
test("Golden #10: Low confidence → routed_to_review", () => {
  const result = matchDocumentToSlot(
    makeIdentity({ effectiveDocType: "BUSINESS_TAX_RETURN", taxYear: 2024, confidence: 0.65, authority: "deterministic" }),
    goldenSlots(),
  );
  assert.equal(result.decision, "routed_to_review");
});

// #11: Probabilistic at 0.83 → routed_to_review
test("Golden #11: Probabilistic at 0.83 → routed_to_review", () => {
  const result = matchDocumentToSlot(
    makeIdentity({ effectiveDocType: "BUSINESS_TAX_RETURN", taxYear: 2024, confidence: 0.83, authority: "probabilistic" }),
    goldenSlots(),
  );
  assert.equal(result.decision, "routed_to_review");
});

// #12: PTR 2022 (deterministic, 0.97) → PTR_2022
test("Golden #12: PTR 2022 → PTR_2022 slot", () => {
  const result = matchDocumentToSlot(
    makeIdentity({ effectiveDocType: "PERSONAL_TAX_RETURN", rawDocType: "IRS_PERSONAL", taxYear: 2022, entityType: "personal" }),
    goldenSlots(),
  );
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "ptr-2022");
});

// #13: BTR 2024 when slot already filled → no_match
test("Golden #13: BTR 2024 when slot filled → no_match", () => {
  const slots = goldenSlots().map((s) =>
    s.slotId === "btr-2024" ? { ...s, status: "attached" } : s,
  );
  const result = matchDocumentToSlot(
    makeIdentity({ effectiveDocType: "BUSINESS_TAX_RETURN", rawDocType: "IRS_BUSINESS", taxYear: 2024, entityType: "business" }),
    slots,
  );
  assert.equal(result.decision, "no_match");
});

// #14: PFS attempting BTR slot only available → no_match (negative rule)
test("Golden #14: PFS with only BTR slot → no_match", () => {
  const slots = [
    makeSlot({ slotId: "btr-2024", slotKey: "BTR_2024", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2024, slotGroup: "tax", sortOrder: 1 }),
  ];
  const result = matchDocumentToSlot(
    makeIdentity({ effectiveDocType: "PFS", rawDocType: "PFS", taxYear: null, entityType: "personal", authority: "probabilistic", confidence: 0.92 }),
    slots,
  );
  assert.equal(result.decision, "no_match");
});

// #15: OTHER doc type → no_match
test("Golden #15: OTHER doc type → no_match", () => {
  const result = matchDocumentToSlot(
    makeIdentity({ effectiveDocType: "OTHER", rawDocType: "OTHER" }),
    goldenSlots(),
  );
  assert.equal(result.decision, "no_match");
});

// ─── CI Invariant: All golden tests above enforce zero wrong-attach ────────
// Each golden test uses assert.equal for expected slot + assert.notEqual for forbidden slots.
// Any wrong-attach fails the specific test directly.
