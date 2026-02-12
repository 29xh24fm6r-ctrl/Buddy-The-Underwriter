import test from "node:test";
import assert from "node:assert/strict";

// parseUtils is pure (no "server-only") — import directly
import {
  isLikelyReferenceNumber,
  looksLikeMoneyToken,
  findLabeledAmount,
  parseMoney,
} from "../parseUtils";

// ── isLikelyReferenceNumber ───────────────────────────────────────────────

test("isLikelyReferenceNumber: 1040 near 'Form' context", () => {
  assert.equal(isLikelyReferenceNumber(1040, "Form 1040 for tax year 2023"), true);
});

test("isLikelyReferenceNumber: 1065 near 'Schedule' context", () => {
  assert.equal(isLikelyReferenceNumber(1065, "See Schedule K-1 (Form 1065)"), true);
});

test("isLikelyReferenceNumber: 1120 near 'IRS' context", () => {
  assert.equal(isLikelyReferenceNumber(1120, "IRS Form 1120 Corporation Return"), true);
});

test("isLikelyReferenceNumber: 4562 depreciation form", () => {
  assert.equal(isLikelyReferenceNumber(4562, "Form 4562 Depreciation"), true);
});

test("isLikelyReferenceNumber: 8825 rental form", () => {
  assert.equal(isLikelyReferenceNumber(8825, "See Form 8825 attached"), true);
});

test("isLikelyReferenceNumber: 1040 without IRS context is not a reference", () => {
  assert.equal(isLikelyReferenceNumber(1040, "Total revenue was 1040 for the period"), false);
});

test("isLikelyReferenceNumber: non-form number is not a reference", () => {
  assert.equal(isLikelyReferenceNumber(5000, "Form 5000 something"), false);
});

test("isLikelyReferenceNumber: 45000 is not in the set", () => {
  assert.equal(isLikelyReferenceNumber(45000, "Form reference 45000"), false);
});

// ── looksLikeMoneyToken ──────────────────────────────────────────────────

test("looksLikeMoneyToken: $ prefix", () => {
  assert.equal(looksLikeMoneyToken("$1040"), true);
});

test("looksLikeMoneyToken: comma-separated", () => {
  assert.equal(looksLikeMoneyToken("1,040"), true);
});

test("looksLikeMoneyToken: parenthetical negative", () => {
  assert.equal(looksLikeMoneyToken("(1065)"), true);
});

test("looksLikeMoneyToken: decimal", () => {
  assert.equal(looksLikeMoneyToken("1040.00"), true);
});

test("looksLikeMoneyToken: 5+ digit number", () => {
  assert.equal(looksLikeMoneyToken("10400"), true);
});

test("looksLikeMoneyToken: bare 4-digit number is NOT money-like", () => {
  assert.equal(looksLikeMoneyToken("1040"), false);
});

test("looksLikeMoneyToken: bare 4-digit number 1065", () => {
  assert.equal(looksLikeMoneyToken("1065"), false);
});

// ── findLabeledAmount with IRS guard ─────────────────────────────────────

test("findLabeledAmount: rejects Form 1065 number as dollar amount", () => {
  // When the label is "gross receipts" and the captured number is 1065 near "Form 1065"
  const text = "Form 1065 gross receipts 1065 partnership";
  const result = findLabeledAmount(text, /gross\s+receipts/i);
  // "1065" after "gross receipts" — context includes "Form" so guard triggers
  if (result.value !== null) {
    assert.notEqual(result.value, 1065, "Should not return 1065 as a dollar value");
  }
});

test("findLabeledAmount: allows $1,040 (money-formatted)", () => {
  const text = "Total expenses: $1,040.00";
  const result = findLabeledAmount(text, /total\s+expenses/i);
  assert.equal(result.value, 1040, "$1,040.00 is a valid money amount");
});

test("findLabeledAmount: allows 1065 when no IRS context nearby", () => {
  const text = "rent collected: 1065 per month";
  const result = findLabeledAmount(text, /rent\s+collected/i);
  assert.equal(result.value, 1065);
});

test("findLabeledAmount: allows real dollar amounts after form-number labels", () => {
  const text = "line 1a gross receipts $125,000";
  const result = findLabeledAmount(text, /line\s+1[abc]?/i);
  assert.equal(result.value, 125000);
});

test("findLabeledAmount: rejects bare 4562 near 'Form' context", () => {
  const text = "See Form 4562 depreciation amount 4562";
  const result = findLabeledAmount(text, /depreciation\s+amount/i);
  if (result.value !== null) {
    assert.notEqual(result.value, 4562);
  }
});

// ── parseMoney sanity checks ─────────────────────────────────────────────

test("parseMoney: standard money", () => {
  assert.equal(parseMoney("$125,000.00"), 125000);
});

test("parseMoney: parenthetical negative", () => {
  assert.equal(parseMoney("(5,000)"), -5000);
});

test("parseMoney: plain number", () => {
  assert.equal(parseMoney("1040"), 1040);
});
