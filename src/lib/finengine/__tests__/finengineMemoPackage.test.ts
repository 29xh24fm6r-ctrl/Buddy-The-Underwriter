/**
 * SPEC-FINENGINE god-tier improvement D — memo assembly + cutover gate tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildFinengineMemoPackage, memoGate, assertCutoverClean } from "@/lib/finengine/memo/finengineMemoPackage";
import type { CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";

const biz = (k: string, p: string, v: number): CertifiedFactRow =>
  ({ fact_key: k, fact_period_end: p, fact_value_num: v, source_canonical_type: "BUSINESS_TAX_RETURN", owner_type: "DEAL", confidence: 0.8, extractor: "gemini_primary_v1", is_superseded: false, created_at: "2026-06-01T00:00:00Z" });

// A clean deal: M1 + NET_INCOME agree, full income statement + balance sheet.
const CLEAN: CertifiedFactRow[] = [
  biz("GROSS_RECEIPTS", "2023-12-31", 15088769), biz("GROSS_RECEIPTS", "2024-12-31", 28767069),
  biz("COST_OF_GOODS_SOLD", "2023-12-31", 13292890), biz("COST_OF_GOODS_SOLD", "2024-12-31", 25233470),
  biz("GROSS_PROFIT", "2023-12-31", 1472421), biz("GROSS_PROFIT", "2024-12-31", 3533599),
  biz("NET_INCOME", "2023-12-31", -457567), biz("NET_INCOME", "2024-12-31", 200925),
  biz("M1_TAXABLE_INCOME", "2023-12-31", -457567), biz("M1_TAXABLE_INCOME", "2024-12-31", 200925),
  biz("TAXABLE_INCOME", "2023-12-31", -457567), biz("TAXABLE_INCOME", "2024-12-31", 200925),
  biz("DEPRECIATION", "2023-12-31", 61656), biz("DEPRECIATION", "2024-12-31", 210207),
  biz("SL_TOTAL_ASSETS", "2024-12-31", 6800000), biz("SL_TOTAL_EQUITY", "2024-12-31", 6800000),
  biz("SL_TOTAL_LIABILITIES", "2024-12-31", 1500000),
];

const baseMemo = { borrower: { displayName: "Acme Co", entityForm: "C_CORP" }, request: { amount: 2_000_000, product: "SBA_7A" } };

describe("memo cutover gate", () => {
  it("a clean spread clears the gate (allowed)", () => {
    const pkg = buildFinengineMemoPackage("d", CLEAN, baseMemo);
    assert.equal(pkg.validation.unexpected, 0);
    assert.equal(pkg.gate.allowed, true);
    assert.equal(pkg.gate.blocked, false);
    assert.match(pkg.gate.reason, /cleared for finalization/i);
    assertCutoverClean(pkg.validation); // does not throw
  });

  it("memoGate maps a blocked validation to allowed=false with a reason", () => {
    const blocked = memoGate({ dealId: "d", checks: [], zero: 0, intended: 0, unexpected: 2, cutoverBlocked: true });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.unexpected, 2);
    assert.match(blocked.reason, /UNEXPECTED/);
    assert.throws(() => assertCutoverClean({ dealId: "d", checks: [], zero: 0, intended: 0, unexpected: 2, cutoverBlocked: true }), /memo blocked/);
  });
});

describe("memo assembly", () => {
  it("feeds engine metrics into buildCreditMemo and appends the credit-spread section", () => {
    const pkg = buildFinengineMemoPackage("d", CLEAN, baseMemo);
    // the engine's metrics flowed into the memo (some section references DSCR/leverage/EBITDA)
    assert.ok(pkg.memo.sections.length > 0);
    const spreadSection = pkg.memo.sections.find((s) => s.key === "credit_spread");
    assert.ok(spreadSection && spreadSection.hasData, "credit-spread section present + populated");
    assert.match(spreadSection!.body, /EBITDA:/);
    assert.match(spreadSection!.body, /cutover-clean/);
  });

  it("passes the caller's non-financial MemoInputs through untouched and augments metrics", () => {
    const withMetric = { ...baseMemo, metrics: [{ metric: "CUSTOM", value: 1, inputs: {}, explanation: "caller-supplied" }] };
    const pkg = buildFinengineMemoPackage("d", CLEAN, withMetric);
    // exec summary still renders the borrower + request from the caller's inputs
    const exec = pkg.memo.sections.find((s) => s.key === "exec_summary");
    assert.ok(exec && /Acme Co/.test(exec.body));
  });

  it("an M1-only deal (no plain TAXABLE_INCOME) still validates clean post-fix and clears the gate", () => {
    const m1Only = CLEAN.filter((r) => r.fact_key !== "TAXABLE_INCOME");
    const pkg = buildFinengineMemoPackage("d", m1Only, baseMemo);
    assert.equal(pkg.gate.allowed, true); // the EBITDA base fix means M1 alone is sufficient
  });
});
