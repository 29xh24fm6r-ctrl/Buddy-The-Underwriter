import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { sanitizeEntityName } from "../sanitizeEntityName";

describe("sanitizeEntityName", () => {
  test("strips PDF label bleed after newline", () => {
    assert.equal(
      sanitizeEntityName("MICHAEL NEWMARK\nTaxpayer address"),
      "MICHAEL NEWMARK",
    );
  });

  test("strips CRLF label bleed", () => {
    assert.equal(
      sanitizeEntityName("JANE DOE\r\nDate of Birth 1970-01-01"),
      "JANE DOE",
    );
  });

  test("strips inline 'Spouse' suffix on a single line", () => {
    assert.equal(sanitizeEntityName("Jane Doe Spouse"), "Jane Doe");
  });

  test("strips inline 'Taxpayer' suffix", () => {
    assert.equal(
      sanitizeEntityName("John Smith Taxpayer XYZ"),
      "John Smith",
    );
  });

  test("collapses internal whitespace", () => {
    assert.equal(sanitizeEntityName("  John   Smith  "), "John Smith");
  });

  test("returns null for empty input", () => {
    assert.equal(sanitizeEntityName(""), null);
    assert.equal(sanitizeEntityName(null), null);
    assert.equal(sanitizeEntityName(undefined), null);
  });

  test("returns null for whitespace-only", () => {
    assert.equal(sanitizeEntityName("   "), null);
    assert.equal(sanitizeEntityName("\n"), null);
    assert.equal(sanitizeEntityName("\r\n"), null);
  });

  test("returns null for too-short result after cleaning", () => {
    assert.equal(sanitizeEntityName("a"), null);
    assert.equal(sanitizeEntityName("A\nTaxpayer"), null);
  });

  test("preserves legitimate multi-word business names", () => {
    assert.equal(
      sanitizeEntityName("Smith Logistics LLC"),
      "Smith Logistics LLC",
    );
    assert.equal(
      sanitizeEntityName("Acme Manufacturing Co."),
      "Acme Manufacturing Co.",
    );
  });

  test("preserves 'Borrower' sentinel", () => {
    assert.equal(sanitizeEntityName("Borrower"), "Borrower");
  });
});
