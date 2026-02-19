/**
 * Negative Rules — Unit Tests
 */

import test from "node:test";
import assert from "node:assert/strict";
import { evaluateNegativeRules, NEGATIVE_RULE_COUNT } from "../negativeRules";
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
    formNumbers: null,
    authority: "deterministic",
    confidence: 0.97,
    classificationEvidence: [],
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

function isBlocked(results: ReturnType<typeof evaluateNegativeRules>, ruleId: string): boolean {
  const rule = results.find((r) => r.ruleId === ruleId);
  return rule?.blocked ?? false;
}

function anyBlocked(results: ReturnType<typeof evaluateNegativeRules>): boolean {
  return results.some((r) => r.blocked);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("NegativeRules: total rule count ≥ 10", () => {
  assert.ok(NEGATIVE_RULE_COUNT >= 10, `Expected ≥ 10 rules, got ${NEGATIVE_RULE_COUNT}`);
});

test("NegativeRules: K-1 blocked from BTR slot", () => {
  const results = evaluateNegativeRules(
    makeIdentity({ rawDocType: "K1", effectiveDocType: "PERSONAL_TAX_RETURN" }),
    makeSlot({ requiredDocType: "BUSINESS_TAX_RETURN" }),
  );
  assert.ok(isBlocked(results, "K1_NOT_BTR"));
});

test("NegativeRules: W-2 blocked from BTR slot", () => {
  const results = evaluateNegativeRules(
    makeIdentity({ rawDocType: "W2", effectiveDocType: "PERSONAL_TAX_RETURN" }),
    makeSlot({ requiredDocType: "BUSINESS_TAX_RETURN" }),
  );
  assert.ok(isBlocked(results, "W2_NOT_BTR"));
});

test("NegativeRules: 1099 blocked from BTR slot", () => {
  const results = evaluateNegativeRules(
    makeIdentity({ rawDocType: "1099", effectiveDocType: "PERSONAL_TAX_RETURN" }),
    makeSlot({ requiredDocType: "BUSINESS_TAX_RETURN" }),
  );
  assert.ok(isBlocked(results, "1099_NOT_BTR"));
});

test("NegativeRules: FORM_1099 blocked from BTR slot", () => {
  const results = evaluateNegativeRules(
    makeIdentity({ rawDocType: "FORM_1099", effectiveDocType: "PERSONAL_TAX_RETURN" }),
    makeSlot({ requiredDocType: "BUSINESS_TAX_RETURN" }),
  );
  assert.ok(isBlocked(results, "1099_NOT_BTR"));
});

test("NegativeRules: personal entity blocked from BTR slot", () => {
  const results = evaluateNegativeRules(
    makeIdentity({
      rawDocType: "PERSONAL_TAX_RETURN",
      effectiveDocType: "PERSONAL_TAX_RETURN",
      entityType: "personal",
    }),
    makeSlot({ requiredDocType: "BUSINESS_TAX_RETURN" }),
  );
  assert.ok(isBlocked(results, "PERSONAL_NOT_BTR"));
});

test("NegativeRules: business entity blocked from PTR slot", () => {
  const results = evaluateNegativeRules(
    makeIdentity({
      rawDocType: "IRS_BUSINESS",
      effectiveDocType: "BUSINESS_TAX_RETURN",
      entityType: "business",
    }),
    makeSlot({ requiredDocType: "PERSONAL_TAX_RETURN" }),
  );
  assert.ok(isBlocked(results, "BUSINESS_NOT_PTR"));
});

test("NegativeRules: FINANCIAL_STATEMENT blocked from PFS slot", () => {
  const results = evaluateNegativeRules(
    makeIdentity({ effectiveDocType: "FINANCIAL_STATEMENT" }),
    makeSlot({ requiredDocType: "PERSONAL_FINANCIAL_STATEMENT" }),
  );
  assert.ok(isBlocked(results, "FIN_STMT_NOT_PFS"));
});

test("NegativeRules: PFS blocked from IS slot", () => {
  const results = evaluateNegativeRules(
    makeIdentity({ effectiveDocType: "PFS" }),
    makeSlot({ requiredDocType: "INCOME_STATEMENT" }),
  );
  assert.ok(isBlocked(results, "PFS_NOT_IS_BS"));
});

test("NegativeRules: PFS blocked from BS slot", () => {
  const results = evaluateNegativeRules(
    makeIdentity({ effectiveDocType: "PFS" }),
    makeSlot({ requiredDocType: "BALANCE_SHEET" }),
  );
  assert.ok(isBlocked(results, "PFS_NOT_IS_BS"));
});

test("NegativeRules: no taxYear blocked from year-specific slot", () => {
  const results = evaluateNegativeRules(
    makeIdentity({ taxYear: null }),
    makeSlot({ requiredTaxYear: 2024 }),
  );
  assert.ok(isBlocked(results, "NO_YEAR_NO_YEAR_SLOT"));
});

test("NegativeRules: BTR blocked from PTR slot", () => {
  const results = evaluateNegativeRules(
    makeIdentity({ effectiveDocType: "BUSINESS_TAX_RETURN" }),
    makeSlot({ requiredDocType: "PERSONAL_TAX_RETURN" }),
  );
  assert.ok(isBlocked(results, "BTR_NOT_PTR"));
});

test("NegativeRules: PTR blocked from BTR slot", () => {
  const results = evaluateNegativeRules(
    makeIdentity({ effectiveDocType: "PERSONAL_TAX_RETURN" }),
    makeSlot({ requiredDocType: "BUSINESS_TAX_RETURN" }),
  );
  assert.ok(isBlocked(results, "PTR_NOT_BTR"));
});

test("NegativeRules: FINANCIAL_STATEMENT umbrella blocked from any slot", () => {
  const results = evaluateNegativeRules(
    makeIdentity({ effectiveDocType: "FINANCIAL_STATEMENT" }),
    makeSlot({ requiredDocType: "INCOME_STATEMENT" }),
  );
  assert.ok(isBlocked(results, "UMBRELLA_NO_AUTO_MATCH"));
});

test("NegativeRules: valid BTR→BTR match has no blocks", () => {
  const results = evaluateNegativeRules(
    makeIdentity({
      effectiveDocType: "BUSINESS_TAX_RETURN",
      rawDocType: "IRS_BUSINESS",
      entityType: "business",
      taxYear: 2024,
    }),
    makeSlot({
      requiredDocType: "BUSINESS_TAX_RETURN",
      requiredTaxYear: 2024,
    }),
  );
  assert.ok(!anyBlocked(results));
});
