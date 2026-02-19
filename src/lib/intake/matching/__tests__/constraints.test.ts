/**
 * Constraint Evaluator — Unit Tests
 */

import test from "node:test";
import assert from "node:assert/strict";
import { evaluateConstraints } from "../constraints";
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

function allSatisfied(results: ReturnType<typeof evaluateConstraints>): boolean {
  return results.every((r) => r.satisfied);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("Constraints: BTR doc matches BTR slot with exact year", () => {
  const results = evaluateConstraints(makeIdentity(), makeSlot());
  assert.ok(allSatisfied(results));
});

test("Constraints: IRS_BUSINESS matches BUSINESS_TAX_RETURN slot", () => {
  const results = evaluateConstraints(
    makeIdentity({ effectiveDocType: "IRS_BUSINESS" }),
    makeSlot(),
  );
  assert.ok(allSatisfied(results));
});

test("Constraints: non-empty slot fails slot_empty", () => {
  const results = evaluateConstraints(
    makeIdentity(),
    makeSlot({ status: "attached" }),
  );
  const slotEmpty = results.find((r) => r.constraint === "slot_empty");
  assert.ok(slotEmpty);
  assert.equal(slotEmpty.satisfied, false);
});

test("Constraints: wrong doc type fails doc_type_match", () => {
  const results = evaluateConstraints(
    makeIdentity({ effectiveDocType: "RENT_ROLL" }),
    makeSlot({ requiredDocType: "BUSINESS_TAX_RETURN" }),
  );
  const docTypeMatch = results.find((r) => r.constraint === "doc_type_match");
  assert.ok(docTypeMatch);
  assert.equal(docTypeMatch.satisfied, false);
});

test("Constraints: FINANCIAL_STATEMENT fails doc_type_match for IS slot", () => {
  const results = evaluateConstraints(
    makeIdentity({ effectiveDocType: "FINANCIAL_STATEMENT" }),
    makeSlot({ requiredDocType: "INCOME_STATEMENT", requiredTaxYear: null }),
  );
  const docTypeMatch = results.find((r) => r.constraint === "doc_type_match");
  assert.ok(docTypeMatch);
  assert.equal(docTypeMatch.satisfied, false);
});

test("Constraints: FINANCIAL_STATEMENT fails doc_type_match for BS slot", () => {
  const results = evaluateConstraints(
    makeIdentity({ effectiveDocType: "FINANCIAL_STATEMENT" }),
    makeSlot({ requiredDocType: "BALANCE_SHEET", requiredTaxYear: null }),
  );
  const docTypeMatch = results.find((r) => r.constraint === "doc_type_match");
  assert.ok(docTypeMatch);
  assert.equal(docTypeMatch.satisfied, false);
});

test("Constraints: FINANCIAL_STATEMENT fails doc_type_match for PFS slot", () => {
  const results = evaluateConstraints(
    makeIdentity({ effectiveDocType: "FINANCIAL_STATEMENT" }),
    makeSlot({ requiredDocType: "PERSONAL_FINANCIAL_STATEMENT", requiredTaxYear: null }),
  );
  const docTypeMatch = results.find((r) => r.constraint === "doc_type_match");
  assert.ok(docTypeMatch);
  assert.equal(docTypeMatch.satisfied, false);
});

test("Constraints: year mismatch fails tax_year_match", () => {
  const results = evaluateConstraints(
    makeIdentity({ taxYear: 2023 }),
    makeSlot({ requiredTaxYear: 2024 }),
  );
  const yearMatch = results.find((r) => r.constraint === "tax_year_match");
  assert.ok(yearMatch);
  assert.equal(yearMatch.satisfied, false);
});

test("Constraints: null taxYear on year-based slot fails year_required", () => {
  const results = evaluateConstraints(
    makeIdentity({ taxYear: null }),
    makeSlot({ requiredTaxYear: 2024 }),
  );
  const yearRequired = results.find((r) => r.constraint === "year_required");
  assert.ok(yearRequired);
  assert.equal(yearRequired.satisfied, false);
});

test("Constraints: non-year slot skips year constraints", () => {
  const results = evaluateConstraints(
    makeIdentity({ effectiveDocType: "PFS", taxYear: null }),
    makeSlot({
      requiredDocType: "PERSONAL_FINANCIAL_STATEMENT",
      requiredTaxYear: null,
    }),
  );
  assert.ok(allSatisfied(results));
});

test("Constraints: PFS matches PERSONAL_FINANCIAL_STATEMENT slot", () => {
  const results = evaluateConstraints(
    makeIdentity({ effectiveDocType: "PFS" }),
    makeSlot({
      requiredDocType: "PERSONAL_FINANCIAL_STATEMENT",
      requiredTaxYear: null,
    }),
  );
  assert.ok(allSatisfied(results));
});

test("Constraints: T12 matches INCOME_STATEMENT slot", () => {
  const results = evaluateConstraints(
    makeIdentity({ effectiveDocType: "T12" }),
    makeSlot({
      requiredDocType: "INCOME_STATEMENT",
      requiredTaxYear: null,
    }),
  );
  assert.ok(allSatisfied(results));
});

test("Constraints: INCOME_STATEMENT matches INCOME_STATEMENT slot", () => {
  const results = evaluateConstraints(
    makeIdentity({ effectiveDocType: "INCOME_STATEMENT" }),
    makeSlot({
      requiredDocType: "INCOME_STATEMENT",
      requiredTaxYear: null,
    }),
  );
  assert.ok(allSatisfied(results));
});

test("Constraints: BALANCE_SHEET exact match", () => {
  const results = evaluateConstraints(
    makeIdentity({ effectiveDocType: "BALANCE_SHEET" }),
    makeSlot({
      requiredDocType: "BALANCE_SHEET",
      requiredTaxYear: null,
    }),
  );
  assert.ok(allSatisfied(results));
});

test("Constraints: year-based slot with null requiredTaxYear passes", () => {
  const results = evaluateConstraints(
    makeIdentity({ effectiveDocType: "BUSINESS_TAX_RETURN", taxYear: 2024 }),
    makeSlot({
      requiredDocType: "BUSINESS_TAX_RETURN",
      requiredTaxYear: null,
    }),
  );
  assert.ok(allSatisfied(results));
});
