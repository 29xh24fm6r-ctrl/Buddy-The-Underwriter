/**
 * SPEC-FINENGINE-LIVE-SPREAD-1 — Phase 3 tests.
 *
 * Locks the independent golden-set derivations and the live-run findings as
 * regressions: the entity-partition EBITDA (business loss, not personal income),
 * and the material UNEXPECTED divergence the live run surfaced — EBITDA is
 * understated whenever a deal carries M1_TAXABLE_INCOME but not the plain
 * TAXABLE_INCOME key (the engine's base priority omits M1_TAXABLE_INCOME).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { goldenEbitda, goldenBase, OMNICARE_GOLDEN_EBITDA } from "@/lib/finengine/spread/fullSpreadGoldenSet";
import { computeDealSpread } from "@/lib/finengine/spread/dealSpread";
import { validateSpread } from "@/lib/finengine/spread/validateSpread";
import type { CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";

function biz(fact_key: string, period: string, v: number, conf = 0.8, ext = "gemini_primary_v1"): CertifiedFactRow {
  return { fact_key, fact_period_end: period, fact_value_num: v, source_canonical_type: "BUSINESS_TAX_RETURN", owner_type: "DEAL", confidence: conf, extractor: ext, is_superseded: false, created_at: "2026-06-01T00:00:00Z" };
}

describe("Phase 3 — independent golden-set (NG4: from filed lines, not the engine)", () => {
  it("conservative EBITDA = base + interest + D&A with the M1 pre-tax base", () => {
    const g = goldenEbitda({ M1_TAXABLE_INCOME: -457567, DEPRECIATION: 61656 });
    assert.equal(g.value, -395911); // the 2023 business loss + dep
    assert.equal(goldenBase({ M1_TAXABLE_INCOME: -457567 }).key, "M1_TAXABLE_INCOME");
  });
  it("the OmniCare anchor matches the by-hand per-year derivation", () => {
    assert.equal(OMNICARE_GOLDEN_EBITDA["2023-12-31"].expected, -395911);
    assert.equal(OMNICARE_GOLDEN_EBITDA["2024-12-31"].expected, 411132);
    assert.equal(OMNICARE_GOLDEN_EBITDA["2022-12-31"].expected, 151225);
  });
});

describe("Phase 3 — entity partition holds on the EBITDA base (V3.2)", () => {
  it("2023 business EBITDA is built from the −457,567 loss, never the personal income", () => {
    const rows: CertifiedFactRow[] = [
      biz("M1_TAXABLE_INCOME", "2023-12-31", -457567), biz("NET_INCOME", "2023-12-31", -457567), biz("DEPRECIATION", "2023-12-31", 61656),
      biz("M1_TAXABLE_INCOME", "2024-12-31", 200925), biz("DEPRECIATION", "2024-12-31", 210207),
      biz("TAXABLE_INCOME", "2024-12-31", 200925),
      // personal pollution on the same key+period
      { fact_key: "TAXABLE_INCOME", fact_period_end: "2023-12-31", fact_value_num: 249968, source_canonical_type: "PERSONAL_TAX_RETURN", owner_type: "DEAL", confidence: 0.8, extractor: "gemini_primary_v1", is_superseded: false, created_at: "2026-06-01T00:00:00Z" },
    ];
    const spread = computeDealSpread("d", rows);
    const e2023 = spread.cells.find((c) => c.scope === "BUSINESS" && c.metric === "EBITDA" && c.period === "2023-12-31");
    assert.equal(e2023?.value, -395911);
    const val = validateSpread(spread, { scope: "BUSINESS" });
    assert.ok(val.checks.some((c) => c.metric === "EBITDA" && c.period === "2023-12-31" && c.classification === "ZERO"));
  });
});

describe("Phase 3 — the live UNEXPECTED finding is locked as a regression (V3.3)", () => {
  // The bug: engine's computeEbitda base priority omits M1_TAXABLE_INCOME, so when
  // a deal carries M1 but not plain TAXABLE_INCOME, EBITDA falls through to NET_INCOME(0).
  const m1Only: CertifiedFactRow[] = [
    biz("M1_TAXABLE_INCOME", "2023-12-31", 100000), biz("NET_INCOME", "2023-12-31", 100000), biz("DEPRECIATION", "2023-12-31", 50000),
    biz("M1_TAXABLE_INCOME", "2024-12-31", 200925), biz("NET_INCOME", "2024-12-31", 0), biz("DEPRECIATION", "2024-12-31", 210207),
  ];
  it("EBITDA is understated (engine 210,207 vs golden 411,132) and flagged UNEXPECTED, blocking cutover", () => {
    const spread = computeDealSpread("d", m1Only);
    const val = validateSpread(spread, { scope: "BUSINESS" });
    const c = val.checks.find((x) => x.metric === "EBITDA" && x.period === "2024-12-31");
    assert.equal(c?.engine, 210207);
    assert.equal(c?.golden, 411132);
    assert.equal(c?.classification, "UNEXPECTED");
    assert.equal(val.cutoverBlocked, true);
  });
  it("registering the divergence as INTENDED unblocks it (the spec's classification mechanism)", () => {
    const spread = computeDealSpread("d", m1Only);
    const val = validateSpread(spread, { scope: "BUSINESS", intended: [{ metric: "EBITDA", period: "2024-12-31", expected: 210207, rationale: "test" }] });
    const c = val.checks.find((x) => x.metric === "EBITDA" && x.period === "2024-12-31");
    assert.equal(c?.classification, "INTENDED");
    assert.equal(val.cutoverBlocked, false);
  });
  it("when plain TAXABLE_INCOME is present the engine matches golden (ZERO)", () => {
    const withTaxable = [...m1Only, biz("TAXABLE_INCOME", "2024-12-31", 200925)];
    const spread = computeDealSpread("d", withTaxable);
    const val = validateSpread(spread, { scope: "BUSINESS" });
    const c = val.checks.find((x) => x.metric === "EBITDA" && x.period === "2024-12-31");
    assert.equal(c?.engine, 411132);
    assert.equal(c?.classification, "ZERO");
  });
});
