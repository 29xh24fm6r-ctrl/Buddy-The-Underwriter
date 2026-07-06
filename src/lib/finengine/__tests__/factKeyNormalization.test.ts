/**
 * SPEC-FINENGINE-CANONICAL-FACT-BRIDGE-1 — normalizeFactKey contract + the
 * vocabulary-consistency invariant: every extraction→canonical target must be a
 * real downstream slot (a canonical metric key, a BALANCE_MAP key, or an
 * INCOME_PRIORITY key). A dangling target is dead vocabulary and fails here.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeFactKey,
  EXTRACTION_TO_CANONICAL,
  CANONICAL_METRIC_KEYS,
} from "../factKeyRegistry";
import { BALANCE_MAP, INCOME_PRIORITY } from "@/lib/modelEngine/buildFinancialModel";

describe("normalizeFactKey", () => {
  it("maps a source-line balance key to its canonical model key", () => {
    assert.equal(normalizeFactKey("SL_CASH"), "CASH_AND_EQUIVALENTS");
  });

  it("maps a source-line income key to its canonical model key", () => {
    assert.equal(normalizeFactKey("SALARIES_WAGES_IS"), "PAYROLL");
  });

  it("passes an already-canonical key through unchanged", () => {
    assert.equal(normalizeFactKey("TOTAL_REVENUE"), "TOTAL_REVENUE");
  });

  it("passes an unknown key through unchanged and never throws", () => {
    assert.equal(normalizeFactKey("UNKNOWN_KEY_XYZ"), "UNKNOWN_KEY_XYZ");
  });

  // SPEC-FINENGINE-EXTRACTION-RECONCILIATION-1 — liability classification
  it("maps shareholder loans and mortgages/notes to LONG_TERM_DEBT", () => {
    assert.equal(normalizeFactKey("SL_LOANS_FROM_SHAREHOLDERS"), "LONG_TERM_DEBT");
    assert.equal(normalizeFactKey("SL_MORTGAGES_NOTES_BONDS"), "LONG_TERM_DEBT");
  });

  it("maps wages payable to ACCRUED_LIABILITIES", () => {
    assert.equal(normalizeFactKey("SL_WAGES_PAYABLE"), "ACCRUED_LIABILITIES");
  });

  it("every canonical target resolves to a real slot (no dead vocabulary)", () => {
    const slots = new Set<string>([
      ...CANONICAL_METRIC_KEYS,
      ...Object.keys(BALANCE_MAP),
      ...Object.keys(INCOME_PRIORITY),
    ]);
    const dangling = Object.entries(EXTRACTION_TO_CANONICAL)
      .filter(([, target]) => !slots.has(target))
      .map(([src, target]) => `${src} → ${target}`);
    assert.deepEqual(
      dangling,
      [],
      `EXTRACTION_TO_CANONICAL targets with no downstream slot: ${dangling.join(", ")}`,
    );
  });
});
