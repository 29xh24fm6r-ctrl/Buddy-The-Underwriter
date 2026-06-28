/**
 * SPEC-FINENGINE-MEMO-CUTOVER-1 — Phase 4 tests: the route selector + loader.
 *
 * The loader's DB access is injected, so this exercises the real selection +
 * assembly + gate logic without a live database.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { memoRenderSource, resolveMemoCutoverFlags, loadFinengineMemo } from "@/lib/finengine/memo/loadFinengineMemo";
import { enforceMemoSubmission } from "@/lib/finengine/memo/finengineMemoPackage";
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

describe("Phase 4 — render-source selector defaults to legacy (V4.1)", () => {
  it("a tenant with no flag gets the unchanged legacy renderer", () => {
    assert.equal(memoRenderSource("bank-x"), "legacy");
    assert.equal(memoRenderSource(null), "legacy");
  });
  it("a flipped-on tenant gets the finengine renderer", () => {
    assert.equal(memoRenderSource("bank-x", { "bank-x": true }), "finengine");
  });
  it("resolveMemoCutoverFlags reads the env allowlist; empty ⇒ all OFF", () => {
    assert.deepEqual(resolveMemoCutoverFlags({}), {});
    assert.deepEqual(resolveMemoCutoverFlags({ MEMO_ENGINE_CUTOVER_TENANTS: "bank-1, bank-2" }), { "bank-1": true, "bank-2": true });
    assert.equal(memoRenderSource("bank-1", resolveMemoCutoverFlags({ MEMO_ENGINE_CUTOVER_TENANTS: "bank-1" })), "finengine");
  });
});

describe("Phase 4 — loadFinengineMemo (injected DB) builds the gated package", () => {
  it("resolves the borrower label from meta and clears the gate on a clean deal", async () => {
    const pkg = await loadFinengineMemo("deal-1", {
      bankId: "bank-x",
      loadRows: async () => CLEAN,
      loadMeta: async () => ({ display_name: null, borrower_name: "Acme Holdings LLC", name: "fixture" }),
    });
    // display_name null → falls back to borrower_name, never the fixture name
    const exec = pkg.memo.sections.find((s) => s.key === "exec_summary");
    assert.ok(exec && /Acme Holdings LLC/.test(exec.body));
    assert.equal(pkg.gate.allowed, true);
    assert.doesNotThrow(() => enforceMemoSubmission(pkg.validation, { cutoverEnabled: true }));
  });

  it("a deal whose spread diverges from the audited anchor blocks submission", async () => {
    const pkg = await loadFinengineMemo("deal-2", {
      loadRows: async () => CLEAN,
      loadMeta: async () => ({ display_name: "Acme Co" }),
      hardAnchors: [{ metric: "EBITDA", period: "2024-12-31", expected: 999_999, source: "deliberately wrong audited anchor" }],
    });
    assert.equal(pkg.gate.allowed, false);
    assert.throws(() => enforceMemoSubmission(pkg.validation, { cutoverEnabled: true }), /blocked/);
  });
});
