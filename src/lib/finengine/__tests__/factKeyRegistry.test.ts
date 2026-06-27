import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifyFactKey,
  isCanonicalMetricKey,
  validateFactKey,
  CANONICAL_METRIC_KEYS,
} from "@/lib/finengine/factKeyRegistry";

describe("factKeyRegistry — report-only classification", () => {
  it("classifies canonical metric keys", () => {
    assert.equal(classifyFactKey("DSCR"), "canonical_metric");
    assert.equal(classifyFactKey("GLOBAL_CASH_FLOW"), "canonical_metric");
    assert.equal(classifyFactKey("EBITDA"), "canonical_metric");
    assert.ok(isCanonicalMetricKey("FCCR"));
  });

  it("classifies live extraction keys (not metrics) as extraction, never unknown", () => {
    // these appear in the live corpus and must NOT be rejected
    assert.equal(classifyFactKey("TOTAL_INCOME"), "extraction");
    assert.equal(classifyFactKey("M1_BOOK_INCOME"), "extraction");
    assert.equal(classifyFactKey("SL_AR_GROSS"), "extraction");
    assert.equal(classifyFactKey("F1125A_PURCHASES"), "extraction");
    assert.equal(classifyFactKey("ORDINARY_BUSINESS_INCOME"), "extraction");
  });

  it("flags a genuinely unknown key", () => {
    assert.equal(classifyFactKey("TOTALLY_MADE_UP_KEY"), "unknown");
    assert.equal(validateFactKey("TOTALLY_MADE_UP_KEY").ok, false);
  });

  it("validate is report-only: known keys ok, never throws", () => {
    assert.equal(validateFactKey("DSCR").ok, true);
    assert.equal(validateFactKey("SL_CASH").ok, true);
    assert.doesNotThrow(() => validateFactKey(""));
  });

  it("the canonical metric set covers the multi-producer keys from §0.c", () => {
    for (const k of ["DSCR", "DSCR_STRESSED_300BPS", "GLOBAL_CASH_FLOW", "GCF_DSCR", "ANNUAL_DEBT_SERVICE"]) {
      assert.ok(CANONICAL_METRIC_KEYS.has(k), `metric set missing ${k}`);
    }
  });
});
