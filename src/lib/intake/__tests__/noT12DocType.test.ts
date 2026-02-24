/**
 * No T12 Doc Type CI Tripwire
 *
 * This test ensures that T12 as a document type label never appears
 * in classification or routing code. T12 as a spread type is fine —
 * only T12 as a canonical_type / doc_type is prohibited.
 *
 * This guards against doc type misidentification that could cause
 * financial data to be routed to the wrong extraction engine.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { resolveDocTypeRouting } from "@/lib/documents/docTypeRouting";

describe("No T12 Doc Type CI Tripwire", () => {
  // Guard 1: T12 raw input must normalize to INCOME_STATEMENT, not stay as T12
  test("Guard 1: T12 input maps to INCOME_STATEMENT canonical type", () => {
    const result = resolveDocTypeRouting("T12");
    assert.equal(
      result.canonical_type,
      "INCOME_STATEMENT",
      "T12 as a raw doc type must normalize to INCOME_STATEMENT, never remain as T12",
    );
  });

  // Guard 2: T12 must route to GEMINI_STRUCTURED (never FINANCIAL_STATEMENT)
  test("Guard 2: T12 routes to GEMINI_STRUCTURED extraction", () => {
    const result = resolveDocTypeRouting("T12");
    assert.equal(
      result.routing_class,
      "GEMINI_STRUCTURED",
      "T12 doc type must route to GEMINI_STRUCTURED (structured assist), not FINANCIAL_STATEMENT (packet)",
    );
  });

  // Guard 3: Whitespace/case variations of T12 also normalize correctly
  test("Guard 3: T12 variants normalize correctly", () => {
    const variants = ["T12", "t12", " T12 "];
    for (const variant of variants) {
      const result = resolveDocTypeRouting(variant);
      assert.equal(
        result.canonical_type,
        "INCOME_STATEMENT",
        `T12 variant "${variant}" must normalize to INCOME_STATEMENT`,
      );
      assert.equal(
        result.routing_class,
        "GEMINI_STRUCTURED",
        `T12 variant "${variant}" must route to GEMINI_STRUCTURED`,
      );
    }
  });
});
