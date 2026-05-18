/**
 * SPEC-NCADS-CCORP-FINAL-1 + SPEC-FACT-DISAMBIGUATION-1 — Guard tests
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const AGG_SRC = readFileSync(
  resolve(__dirname, "../runCashFlowAggregator.ts"), "utf-8",
);
const ROUTE_SRC = readFileSync(
  resolve(__dirname, "../../../app/api/deals/[dealId]/financial-snapshot/recompute/route.ts"),
  "utf-8",
);

describe("SPEC-NCADS-CCORP-FINAL-1 guards", () => {
  test("C-Corp addback uses source_canonical_type filter", () => {
    assert.ok(AGG_SRC.includes('source_canonical_type", "BUSINESS_TAX_RETURN"'));
  });

  test("C-Corp addback does NOT use bizTaxDocIds two-step pattern", () => {
    assert.ok(!AGG_SRC.includes("bizTaxDocIds"));
  });

  test("C-Corp addback uses selectBestFact for fact resolution", () => {
    assert.ok(AGG_SRC.includes("selectBestFact(taxableFacts)"));
  });

  test("C-Corp addback uses fact_value_num > 0 guard on TAXABLE_INCOME", () => {
    assert.ok(AGG_SRC.includes("Number(r.fact_value_num) > 0"));
  });

  test("recompute route invalidates stale sentinel facts before aggregator runs", () => {
    const invalidateIdx = ROUTE_SRC.indexOf("is_superseded: true");
    const aggregatorIdx = ROUTE_SRC.indexOf("runCashFlowAggregator");
    assert.ok(invalidateIdx > 0);
    assert.ok(invalidateIdx < aggregatorIdx);
  });

  test("recompute route returns ncadsWarnings in response body", () => {
    assert.ok(ROUTE_SRC.includes("ncadsWarnings: aggregatorWarnings"));
  });
});
