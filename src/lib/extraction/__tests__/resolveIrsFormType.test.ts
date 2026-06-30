/**
 * SPEC-EXTRACT-VALIDATOR-WIRE-1 (rev 2) §1 — resolver + tax-return guard tests.
 *
 * V-1: resolveIrsFormType table coverage
 * V-2: isTaxReturnDocument coverage
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveIrsFormType,
  isTaxReturnDocument,
  isBalanceSheetDocument,
  isValidatableDocument,
  TAX_RETURN_CANONICAL_TYPES,
} from "@/lib/extraction/resolveIrsFormType";

// ── V-1: resolveIrsFormType ────────────────────────────────────────────────

test("[evw-v1-a] ai_form_numbers=[1120] + generic BUSINESS_TAX_RETURN → FORM_1120", () => {
  assert.equal(
    resolveIrsFormType({
      canonical_type: "BUSINESS_TAX_RETURN",
      ai_form_numbers: ["1120"],
      document_type: null,
    }),
    "FORM_1120",
  );
});

test("[evw-v1-b] ai_form_numbers=[1120S] → FORM_1120S", () => {
  assert.equal(
    resolveIrsFormType({
      canonical_type: "BUSINESS_TAX_RETURN",
      ai_form_numbers: ["1120S"],
      document_type: null,
    }),
    "FORM_1120S",
  );
});

test("[evw-v1-c] ai_form_numbers=[1065] → FORM_1065", () => {
  assert.equal(
    resolveIrsFormType({
      canonical_type: "BUSINESS_TAX_RETURN",
      ai_form_numbers: ["1065"],
      document_type: null,
    }),
    "FORM_1065",
  );
});

test("[evw-v1-d] ai_form_numbers=[1040] → FORM_1040", () => {
  assert.equal(
    resolveIrsFormType({
      canonical_type: "PERSONAL_TAX_RETURN",
      ai_form_numbers: ["1040"],
      document_type: null,
    }),
    "FORM_1040",
  );
});

test("[evw-v1-d2] ai_form_numbers=[1040-SR] → FORM_1040", () => {
  assert.equal(
    resolveIrsFormType({
      canonical_type: null,
      ai_form_numbers: ["1040-SR"],
      document_type: null,
    }),
    "FORM_1040",
  );
});

test("[evw-v1-e] canonical_type=TAX_RETURN_1120 + null form numbers → FORM_1120", () => {
  assert.equal(
    resolveIrsFormType({
      canonical_type: "TAX_RETURN_1120",
      ai_form_numbers: null,
      document_type: null,
    }),
    "FORM_1120",
  );
});

test("[evw-v1-f] canonical_type=PERSONAL_TAX_RETURN + null form numbers → FORM_1040", () => {
  assert.equal(
    resolveIrsFormType({
      canonical_type: "PERSONAL_TAX_RETURN",
      ai_form_numbers: null,
      document_type: null,
    }),
    "FORM_1040",
  );
});

test("[evw-v1-g] all null/empty → null", () => {
  assert.equal(
    resolveIrsFormType({
      canonical_type: null,
      ai_form_numbers: null,
      document_type: null,
    }),
    null,
  );
  assert.equal(
    resolveIrsFormType({
      canonical_type: "",
      ai_form_numbers: [],
      document_type: null,
    }),
    null,
  );
});

test("[evw-v1-h] generic BUSINESS_TAX_RETURN with no ai_form_numbers → null (today's bug, validator persists SKIPPED row)", () => {
  // The whole reason rev 2 exists. Without ai_form_numbers, BUSINESS_TAX_RETURN
  // cannot be routed and the validator must persist a SKIPPED audit row.
  assert.equal(
    resolveIrsFormType({
      canonical_type: "BUSINESS_TAX_RETURN",
      ai_form_numbers: null,
      document_type: null,
    }),
    null,
  );
});

test("[evw-v1-i] ai_form_numbers priority wins over canonical_type", () => {
  // If ai_form_numbers contradicts a specific canonical_type, ai_form_numbers wins.
  // This codifies that ai_form_numbers (Tier 1 anchor, 0.97 conf) is more authoritative.
  assert.equal(
    resolveIrsFormType({
      canonical_type: "TAX_RETURN_1120",
      ai_form_numbers: ["1065"],
      document_type: null,
    }),
    "FORM_1065",
  );
});

test("[evw-v1-j] SCHEDULE_E and SCHEDULE_C canonical_type pass through", () => {
  assert.equal(
    resolveIrsFormType({
      canonical_type: "SCHEDULE_E",
      ai_form_numbers: null,
      document_type: null,
    }),
    "SCHEDULE_E",
  );
  assert.equal(
    resolveIrsFormType({
      canonical_type: "SCHEDULE_C",
      ai_form_numbers: null,
      document_type: null,
    }),
    "SCHEDULE_C",
  );
});

// ── V-2: isTaxReturnDocument ───────────────────────────────────────────────

test("[evw-v2-a] returns true for every value in TAX_RETURN_CANONICAL_TYPES", () => {
  for (const ct of TAX_RETURN_CANONICAL_TYPES) {
    assert.equal(
      isTaxReturnDocument({ canonical_type: ct }),
      true,
      `Expected isTaxReturnDocument(${ct}) === true`,
    );
  }
});

test("[evw-v2-b] returns true regardless of canonical_type case", () => {
  assert.equal(isTaxReturnDocument({ canonical_type: "business_tax_return" }), true);
  assert.equal(isTaxReturnDocument({ canonical_type: "Business_Tax_Return" }), true);
});

test("[evw-v2-c] returns false for known non-tax canonical types", () => {
  const nonTaxTypes = [
    "BANK_STATEMENT",
    "PFS",
    "PERSONAL_FINANCIAL_STATEMENT",
    "AR_AGING",
    "BALANCE_SHEET",
    "INCOME_STATEMENT",
    "T12",
    "RENT_ROLL",
    "LEASE",
    "GENERIC",
  ];
  for (const ct of nonTaxTypes) {
    assert.equal(
      isTaxReturnDocument({ canonical_type: ct }),
      false,
      `Expected isTaxReturnDocument(${ct}) === false`,
    );
  }
});

test("[evw-v2-d] returns false for null and unknown strings", () => {
  assert.equal(isTaxReturnDocument({ canonical_type: null }), false);
  assert.equal(isTaxReturnDocument({ canonical_type: "" }), false);
  assert.equal(isTaxReturnDocument({ canonical_type: "UNKNOWN_GIBBERISH_TYPE" }), false);
});

test("[evw-v2-e] TAX_RETURN_CANONICAL_TYPES has 17 entries (matches spec V-2)", () => {
  assert.equal(TAX_RETURN_CANONICAL_TYPES.size, 17);
});

// ── SPEC-BALANCE-SHEET-INTEGRITY-GATE-1 §4: balance-sheet resolver predicates ──

test("[bsi-r1] isBalanceSheetDocument true for BALANCE_SHEET (case-insensitive), false otherwise", () => {
  assert.equal(isBalanceSheetDocument({ canonical_type: "BALANCE_SHEET" }), true);
  assert.equal(isBalanceSheetDocument({ canonical_type: "balance_sheet" }), true);
  assert.equal(isBalanceSheetDocument({ canonical_type: "BUSINESS_TAX_RETURN" }), false);
  assert.equal(isBalanceSheetDocument({ canonical_type: "PERSONAL_FINANCIAL_STATEMENT" }), false);
  assert.equal(isBalanceSheetDocument({ canonical_type: null }), false);
});

test("[bsi-r2] isValidatableDocument true for a 1120 row AND a balance-sheet row", () => {
  assert.equal(isValidatableDocument({ canonical_type: "BUSINESS_TAX_RETURN" }), true);
  assert.equal(isValidatableDocument({ canonical_type: "BALANCE_SHEET" }), true);
  // Still false for unrelated non-validatable docs
  assert.equal(isValidatableDocument({ canonical_type: "BANK_STATEMENT" }), false);
  assert.equal(isValidatableDocument({ canonical_type: "PERSONAL_FINANCIAL_STATEMENT" }), false);
});

test("[bsi-r3] resolveIrsFormType returns BALANCE_SHEET for a balance-sheet row (no ai_form_numbers)", () => {
  assert.equal(
    resolveIrsFormType({
      canonical_type: "BALANCE_SHEET",
      ai_form_numbers: null,
      document_type: null,
    }),
    "BALANCE_SHEET",
  );
});

test("[bsi-r4] resolveIrsFormType unchanged for tax-return rows (no regression)", () => {
  assert.equal(
    resolveIrsFormType({ canonical_type: "TAX_RETURN_1120", ai_form_numbers: null, document_type: null }),
    "FORM_1120",
  );
  // A balance sheet is NOT a tax return
  assert.equal(isTaxReturnDocument({ canonical_type: "BALANCE_SHEET" }), false);
});
