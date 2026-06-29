/**
 * SPEC-FINENGINE-COMPLETE-BUILD-1 Workstream A — render-path tests.
 *
 * The legacy generate route is unchanged when the tenant is on legacy (the
 * default); the finengine renderer shapes the engine package into the route's
 * { sections } payload when a tenant is flipped ON.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { memoRenderSource, resolveMemoCutoverFlags, loadFinengineMemo, renderFinengineMemoNarrative } from "@/lib/finengine/memo/loadFinengineMemo";
import type { CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";

const biz = (k: string, p: string, v: number): CertifiedFactRow =>
  ({ fact_key: k, fact_period_end: p, fact_value_num: v, source_canonical_type: "BUSINESS_TAX_RETURN", owner_type: "DEAL", confidence: 0.8, extractor: "gemini_primary_v1", is_superseded: false, created_at: "2026-06-01T00:00:00Z" });

const CLEAN: CertifiedFactRow[] = [
  biz("GROSS_RECEIPTS", "2024-12-31", 28767069), biz("GROSS_PROFIT", "2024-12-31", 3533599),
  biz("NET_INCOME", "2024-12-31", 200925), biz("M1_TAXABLE_INCOME", "2024-12-31", 200925),
  biz("TAXABLE_INCOME", "2024-12-31", 200925), biz("DEPRECIATION", "2024-12-31", 210207),
  biz("SL_TOTAL_EQUITY", "2024-12-31", 5300000), biz("SL_TOTAL_LIABILITIES", "2024-12-31", 1500000),
  biz("TOTAL_CURRENT_ASSETS", "2024-12-31", 6800000), biz("TOTAL_CURRENT_LIABILITIES", "2024-12-31", 1500000),
];

describe("Workstream A — render-source gating (legacy stays default)", () => {
  it("a tenant with no flag stays on the legacy generate path", () => {
    assert.equal(memoRenderSource("bank-1", resolveMemoCutoverFlags({})), "legacy");
  });
  it("only an allowlisted tenant routes to the finengine renderer", () => {
    assert.equal(memoRenderSource("bank-1", resolveMemoCutoverFlags({ MEMO_ENGINE_CUTOVER_TENANTS: "bank-1" })), "finengine");
  });
});

describe("Workstream A — renderFinengineMemoNarrative shapes the engine memo", () => {
  it("emits the route's { sections } payload with every engine section", async () => {
    const pkg = await loadFinengineMemo("d", {
      bankId: "bank-1",
      loadRows: async () => CLEAN,
      loadMeta: async () => ({ display_name: "Acme Co" }),
      loadNaics: async () => null,
      signals: {
        productId: "SBA_7A_STANDARD",
        riskObligor: { dscr: 1.4, leverage: 2.5 },
        riskFacility: { collateralCoverage: 1.3, lienPosition: 1 },
      },
    });
    const memo = renderFinengineMemoNarrative(pkg);
    assert.equal(memo.source, "finengine");
    assert.ok(Array.isArray(memo.sections) && memo.sections.length > 0);
    // section shape matches the route contract: { key, title, body }
    for (const s of memo.sections) {
      assert.ok(typeof s.key === "string" && typeof s.title === "string" && typeof s.body === "string");
    }
    // engine-computed sections are present
    for (const key of ["exec_summary", "risk_rating", "credit_spread", "recommendation"]) {
      assert.ok(memo.sections.some((s) => s.key === key), `section ${key} present`);
    }
  });

  it("renders the display_name fallback label (never blank, never a fixture leak)", async () => {
    const pkg = await loadFinengineMemo("d", {
      bankId: "bank-1",
      loadRows: async () => CLEAN,
      loadMeta: async () => ({ display_name: null, borrower_name: "Fallback Holdings LLC", name: "fixture" }),
      loadNaics: async () => null,
    });
    const memo = renderFinengineMemoNarrative(pkg);
    const exec = memo.sections.find((s) => s.key === "exec_summary");
    assert.ok(exec && /Fallback Holdings LLC/.test(exec.body));
  });
});
