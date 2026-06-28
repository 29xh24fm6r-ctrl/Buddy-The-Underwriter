/**
 * SPEC-FINENGINE-LIVE-SPREAD-1 follow-on — spread → memo bridge tests.
 *
 * Verifies the DealSpread surfaces into MemoInputs.metrics + a credit-spread
 * MemoSection, and that the contribution plugs into the real buildCreditMemo.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computeDealSpread } from "@/lib/finengine/spread/dealSpread";
import { dealSpreadToMetricResults, buildSpreadMemoSection, spreadToMemoContribution, realPeriods } from "@/lib/finengine/spread/spreadMemo";
import { buildCreditMemo } from "@/lib/finengine/memo/buildCreditMemo";
import type { CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";

const biz = (k: string, p: string, v: number): CertifiedFactRow =>
  ({ fact_key: k, fact_period_end: p, fact_value_num: v, source_canonical_type: "BUSINESS_TAX_RETURN", owner_type: "DEAL", confidence: 0.8, extractor: "gemini_primary_v1", is_superseded: false, created_at: "2026-06-01T00:00:00Z" });

const ROWS: CertifiedFactRow[] = [
  biz("GROSS_RECEIPTS", "2023-12-31", 15088769), biz("GROSS_RECEIPTS", "2024-12-31", 28767069),
  biz("COST_OF_GOODS_SOLD", "2023-12-31", 13292890), biz("COST_OF_GOODS_SOLD", "2024-12-31", 25233470),
  biz("GROSS_PROFIT", "2023-12-31", 1472421), biz("GROSS_PROFIT", "2024-12-31", 3533599),
  biz("NET_INCOME", "2023-12-31", -457567), biz("NET_INCOME", "2024-12-31", 0),
  biz("M1_TAXABLE_INCOME", "2023-12-31", -457567), biz("M1_TAXABLE_INCOME", "2024-12-31", 200925),
  biz("DEPRECIATION", "2023-12-31", 61656), biz("DEPRECIATION", "2024-12-31", 210207),
  biz("TOTAL_CURRENT_ASSETS", "2023-12-31", 2950000), biz("TOTAL_CURRENT_LIABILITIES", "2023-12-31", 1773043),
  biz("SL_TOTAL_ASSETS", "2023-12-31", 3003718), biz("SL_TOTAL_ASSETS", "2024-12-31", 6800000),
  biz("SL_TOTAL_EQUITY", "2023-12-31", 1230675), biz("SL_TOTAL_EQUITY", "2024-12-31", 6800000),
  biz("SL_TOTAL_LIABILITIES", "2023-12-31", 1773043), biz("SL_TOTAL_LIABILITIES", "2024-12-31", 1500000),
  biz("SL_RETAINED_EARNINGS", "2023-12-31", 1230675), biz("SL_RETAINED_EARNINGS", "2024-12-31", 4512938),
];

const spread = computeDealSpread("d", ROWS);

describe("spread → MemoInputs.metrics", () => {
  it("emits MetricResult[] for the latest real period with explanations + passesFloor", () => {
    const metrics = dealSpreadToMetricResults(spread, "BUSINESS");
    assert.ok(metrics.length > 0);
    const de = metrics.find((m) => m.metric === "DEBT_TO_EQUITY");
    assert.ok(de && de.value != null && de.explanation.length > 0);
    // latest real period is 2024; debt/equity = 1,500,000 / 6,800,000
    assert.ok(Math.abs(de!.value! - 1500000 / 6800000) < 1e-6);
    // every metric carries inputs + an explanation
    for (const m of metrics) {
      assert.ok(typeof m.explanation === "string" && m.explanation.length > 0, `${m.metric} explained`);
      assert.ok(m.inputs && typeof m.inputs === "object");
    }
  });

  it("respects an explicit period", () => {
    const m2023 = dealSpreadToMetricResults(spread, "BUSINESS", "2023-12-31");
    const de = m2023.find((x) => x.metric === "DEBT_TO_EQUITY");
    assert.ok(de && Math.abs(de.value! - 1773043 / 1230675) < 1e-6);
  });
});

describe("spread → credit-spread MemoSection", () => {
  it("renders a multi-period headline table with ratings and the EBITDA row", () => {
    const sec = buildSpreadMemoSection(spread, { scope: "BUSINESS" });
    assert.equal(sec.key, "credit_spread");
    assert.equal(sec.hasData, true);
    assert.match(sec.body, /EBITDA:/);
    assert.match(sec.body, /DEBT_TO_EQUITY:/);
    assert.match(sec.body, /2023-12-31, 2024-12-31/);
  });

  it("surfaces red flags and the validation/cutover status", () => {
    const sec = buildSpreadMemoSection(spread, { scope: "BUSINESS", validation: { unexpected: 0, cutoverBlocked: false } });
    assert.match(sec.body, /Red flags:/);
    assert.match(sec.body, /cutover-clean/);
    const blocked = buildSpreadMemoSection(spread, { scope: "BUSINESS", validation: { unexpected: 1, cutoverBlocked: true } });
    assert.match(blocked.body, /CUTOVER BLOCKED/);
  });

  it("is empty-safe on a spread with no real periods", () => {
    const empty = buildSpreadMemoSection(computeDealSpread("x", []), { scope: "BUSINESS" });
    assert.equal(empty.hasData, false);
    assert.match(empty.body, /data not yet available/);
    assert.deepEqual(realPeriods(computeDealSpread("x", []), "BUSINESS"), []);
  });
});

describe("the contribution plugs into the real buildCreditMemo", () => {
  it("feeds MemoInputs.metrics and renders without computing a number", () => {
    const { metrics, section } = spreadToMemoContribution(spread, { scope: "BUSINESS", validation: { unexpected: 0, cutoverBlocked: false } });
    const memo = buildCreditMemo({ borrower: { displayName: "Test Borrower", entityForm: "C_CORP" }, metrics });
    assert.ok(memo.sections.length > 0);
    // the spread section is well-formed and can be appended to the memo's sections
    assert.equal(section.hasData, true);
    assert.ok(memo.sections.every((s) => typeof s.body === "string"));
  });
});
