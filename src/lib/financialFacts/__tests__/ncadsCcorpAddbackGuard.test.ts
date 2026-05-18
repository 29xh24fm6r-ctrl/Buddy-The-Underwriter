/**
 * SPEC-NCADS-CCORP-FINAL-1 — Guard tests (2026-05-18)
 *
 * Proves:
 *   1. C-Corp addback query joins deal_documents for canonical_type filter
 *   2. Recompute route invalidates stale sentinel facts before aggregator
 *   3. Recompute route returns ncadsWarnings in response
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const AGG_SRC = readFileSync(
  resolve(__dirname, "../runCashFlowAggregator.ts"),
  "utf-8",
);

const ROUTE_SRC = readFileSync(
  resolve(
    __dirname,
    "../../../app/api/deals/[dealId]/financial-snapshot/recompute/route.ts",
  ),
  "utf-8",
);

describe("SPEC-NCADS-CCORP-FINAL-1 guards", () => {
  test("C-Corp addback query joins deal_documents table", () => {
    assert.ok(
      AGG_SRC.includes("deal_documents!inner"),
      "C-Corp addback must join deal_documents with !inner to filter by canonical_type",
    );
  });

  test("C-Corp addback filters deal_documents.canonical_type = BUSINESS_TAX_RETURN", () => {
    assert.ok(
      AGG_SRC.includes("BUSINESS_TAX_RETURN"),
      "C-Corp addback must filter by canonical_type=BUSINESS_TAX_RETURN",
    );
  });

  test("C-Corp addback uses fact_value_num > 0 guard on TAXABLE_INCOME", () => {
    assert.ok(
      AGG_SRC.includes("Number(r.fact_value_num) > 0"),
      "TAXABLE_INCOME find must exclude zero values",
    );
  });

  test("recompute route invalidates stale sentinel facts before aggregator runs", () => {
    const invalidateIdx = ROUTE_SRC.indexOf("is_superseded: true");
    const aggregatorIdx = ROUTE_SRC.indexOf("runCashFlowAggregator");
    assert.ok(invalidateIdx > 0, "Route must invalidate stale facts");
    assert.ok(
      invalidateIdx < aggregatorIdx,
      "Invalidation must happen before aggregator call",
    );
  });

  test("recompute route returns ncadsWarnings in response body", () => {
    assert.ok(
      ROUTE_SRC.includes("ncadsWarnings: aggregatorWarnings"),
      "Response must include ncadsWarnings from aggregator",
    );
  });
});
