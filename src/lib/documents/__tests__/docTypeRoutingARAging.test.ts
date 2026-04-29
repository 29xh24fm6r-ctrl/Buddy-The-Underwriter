/**
 * AR Aging — canonical type routing.
 *
 * Verifies that any reasonable string the upstream classifier emits for an
 * AR aging document normalizes to canonical_type === "AR_AGING" with a
 * sensible routing class. Without this contract, tier2Structural emitting
 * "AR_AGING" gets silently collapsed to "OTHER" by the docTypeRouting
 * normalizer — which is exactly the bug PR #356 hits.
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { resolveDocTypeRouting, routingClassFor } from "../docTypeRouting";

describe("docTypeRouting — AR_AGING canonical mapping", () => {
  test("AR_AGING raw → canonical AR_AGING + GEMINI_STANDARD", () => {
    const result = resolveDocTypeRouting("AR_AGING");
    assert.equal(result.canonical_type, "AR_AGING");
    assert.equal(result.routing_class, "GEMINI_STANDARD");
  });

  test("ACCOUNTS_RECEIVABLE_AGING → AR_AGING", () => {
    const result = resolveDocTypeRouting("ACCOUNTS_RECEIVABLE_AGING");
    assert.equal(result.canonical_type, "AR_AGING");
  });

  test("UK 'ACCOUNTS_RECEIVABLE_AGEING' → AR_AGING", () => {
    const result = resolveDocTypeRouting("ACCOUNTS_RECEIVABLE_AGEING");
    assert.equal(result.canonical_type, "AR_AGING");
  });

  test("RECEIVABLES_AGING → AR_AGING", () => {
    const result = resolveDocTypeRouting("RECEIVABLES_AGING");
    assert.equal(result.canonical_type, "AR_AGING");
  });

  test("AGED_RECEIVABLES → AR_AGING", () => {
    const result = resolveDocTypeRouting("AGED_RECEIVABLES");
    assert.equal(result.canonical_type, "AR_AGING");
  });

  test("CUSTOMER_AGING → AR_AGING", () => {
    const result = resolveDocTypeRouting("CUSTOMER_AGING");
    assert.equal(result.canonical_type, "AR_AGING");
  });

  test("AR_AGING_SUMMARY (QuickBooks variant) → AR_AGING", () => {
    const result = resolveDocTypeRouting("AR_AGING_SUMMARY");
    assert.equal(result.canonical_type, "AR_AGING");
  });

  test("OPEN_RECEIVABLES → AR_AGING", () => {
    const result = resolveDocTypeRouting("OPEN_RECEIVABLES");
    assert.equal(result.canonical_type, "AR_AGING");
  });

  test("hyphenated 'ar-aging' (case-insensitive) → AR_AGING", () => {
    // The normalizer collapses spaces and hyphens to underscores, so
    // upstream emitters that use kebab/space separators still resolve.
    const result = resolveDocTypeRouting("ar-aging");
    assert.equal(result.canonical_type, "AR_AGING");
  });

  test("lowercase 'accounts receivable aging' → AR_AGING", () => {
    const result = resolveDocTypeRouting("accounts receivable aging");
    assert.equal(result.canonical_type, "AR_AGING");
  });

  test("routingClassFor('AR_AGING') === 'GEMINI_STANDARD'", () => {
    assert.equal(routingClassFor("AR_AGING"), "GEMINI_STANDARD");
  });

  test("AR_AGING is NOT collapsed to OTHER (regression guard)", () => {
    // The bug PR #356 hits: AR_AGING strings collapse to OTHER, so the
    // collateral processor never runs. This test fails loudly if we ever
    // regress.
    const cases = [
      "AR_AGING",
      "ACCOUNTS_RECEIVABLE_AGING",
      "RECEIVABLES_AGING",
      "AGED_RECEIVABLES",
    ];
    for (const raw of cases) {
      const result = resolveDocTypeRouting(raw);
      assert.notEqual(
        result.canonical_type,
        "OTHER",
        `${raw} must not collapse to OTHER`,
      );
    }
  });
});
