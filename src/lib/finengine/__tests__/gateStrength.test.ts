/**
 * SPEC-FINENGINE-MEMO-CUTOVER-1 — Phase 1 tests: the strengthened gate.
 *
 * Proves the gate now catches green-but-wrong SELECTION bugs (not just
 * computation), enforces the independent EBITDA hard anchor, and covers the
 * decision metrics the memo surfaces.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computeDealSpread } from "@/lib/finengine/spread/dealSpread";
import { validateSpread, type HardAnchor } from "@/lib/finengine/spread/validateSpread";
import { independentRawSelect } from "@/lib/finengine/spread/selectionGuard";
import { OMNICARE_GOLDEN_EBITDA } from "@/lib/finengine/spread/fullSpreadGoldenSet";
import type { CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";

const GEM = "gemini_primary_v1", DET = "taxReturnExtractor:v2:deterministic";
function row(k: string, p: string, v: number, sct: string, owner: string, conf: number, ext: string): CertifiedFactRow {
  return { fact_key: k, fact_period_end: p, fact_value_num: v, source_canonical_type: sct, owner_type: owner, confidence: conf, extractor: ext, is_superseded: false, created_at: "2026-06-01T00:00:00Z" };
}
const biz = (k: string, p: string, v: number, conf = 0.8, ext = GEM) => row(k, p, v, "BUSINESS_TAX_RETURN", "DEAL", conf, ext);

// OmniCare-shaped: the business loss collides with the guarantor's personal income on TAXABLE_INCOME.
const ROWS: CertifiedFactRow[] = [
  biz("TAXABLE_INCOME", "2023-12-31", -457567, 0.5, DET),
  row("TAXABLE_INCOME", "2023-12-31", 249968, "PERSONAL_TAX_RETURN", "DEAL", 0.8, GEM), // personal pollution
  biz("M1_TAXABLE_INCOME", "2023-12-31", -457567), biz("M1_TAXABLE_INCOME", "2023-12-31", 27, 0.5, DET),
  biz("NET_INCOME", "2023-12-31", -457567),
  biz("DEPRECIATION", "2023-12-31", 61656),
  biz("GROSS_RECEIPTS", "2023-12-31", 15088769), biz("GROSS_PROFIT", "2023-12-31", 1472421),
  biz("SL_TOTAL_EQUITY", "2023-12-31", 1230675), biz("SL_TOTAL_LIABILITIES", "2023-12-31", 1773043),
  biz("SL_INTANGIBLES_GROSS", "2023-12-31", 30000),
  biz("TOTAL_CURRENT_ASSETS", "2023-12-31", 2950000), biz("TOTAL_CURRENT_LIABILITIES", "2023-12-31", 1773043),
];

describe("Phase 1 — independent raw selection (NG5, separate code path)", () => {
  it("partitions to the business value over a higher-confidence personal one", () => {
    const r = independentRawSelect(ROWS, "TAXABLE_INCOME", "BUSINESS", "2023-12-31");
    assert.equal(r.value, -457567); // not the personal 249,968 despite its higher confidence
    assert.equal(r.source, "BUSINESS_TAX_RETURN");
  });
  it("the same key resolves PERSONAL scope to the guarantor income", () => {
    assert.equal(independentRawSelect(ROWS, "TAXABLE_INCOME", "PERSONAL", "2023-12-31").value, 249968);
  });
});

describe("Phase 1 — selection-layer guard catches green-but-wrong", () => {
  it("agrees with the adapter on a correct spread (no selection UNEXPECTED)", () => {
    const spread = computeDealSpread("d", ROWS);
    const val = validateSpread(spread, { scope: "BUSINESS", rawRows: ROWS });
    const selChecks = val.checks.filter((c) => c.metric.startsWith("SELECT:"));
    assert.ok(selChecks.length > 0, "selection checks ran");
    assert.equal(selChecks.filter((c) => c.classification === "UNEXPECTED").length, 0);
  });

  it("flags a tampered snapshot that selected the personal income for a BUSINESS metric", () => {
    const spread = computeDealSpread("d", ROWS);
    // Simulate a hypothetical adapter mis-selection: business TAXABLE_INCOME = the personal value.
    const snap = spread.snapshots.find((s) => s.entityScope === "BUSINESS" && s.fiscalPeriodEnd === "2023-12-31")!;
    snap.facts["TAXABLE_INCOME"] = 249968;
    const val = validateSpread(spread, { scope: "BUSINESS", rawRows: ROWS });
    const bad = val.checks.find((c) => c.metric === "SELECT:TAXABLE_INCOME");
    assert.equal(bad?.classification, "UNEXPECTED");
    assert.equal(bad?.engine, 249968);
    assert.equal(bad?.golden, -457567);
    assert.equal(val.cutoverBlocked, true);
  });
});

describe("Phase 1 — independent EBITDA hard anchor (OMNICARE_GOLDEN_EBITDA)", () => {
  it("enforces the pre-registered audited 2023 value −395,911 against the engine", () => {
    const spread = computeDealSpread("d", ROWS);
    const anchors: HardAnchor[] = [{ metric: "EBITDA", period: "2023-12-31", expected: OMNICARE_GOLDEN_EBITDA["2023-12-31"].expected, source: "audited" }];
    const val = validateSpread(spread, { scope: "BUSINESS", hardAnchors: anchors });
    const anchor = val.checks.find((c) => c.metric === "ANCHOR:EBITDA" && c.period === "2023-12-31");
    assert.equal(anchor?.golden, -395911);
    assert.equal(anchor?.classification, "ZERO"); // engine matches the audited anchor
  });
  it("blocks cutover when the engine disagrees with the audited anchor", () => {
    const spread = computeDealSpread("d", ROWS);
    const anchors: HardAnchor[] = [{ metric: "EBITDA", period: "2023-12-31", expected: 999999, source: "deliberately wrong" }];
    const val = validateSpread(spread, { scope: "BUSINESS", hardAnchors: anchors });
    assert.equal(val.cutoverBlocked, true);
  });
});

describe("Phase 1 — decision-metric golden coverage expanded", () => {
  it("validates ETNW and debt-to-ETNW against independent filed-line derivations", () => {
    const spread = computeDealSpread("d", ROWS);
    const val = validateSpread(spread, { scope: "BUSINESS" });
    const etnw = val.checks.find((c) => c.metric === "EFFECTIVE_TANGIBLE_NET_WORTH");
    assert.ok(etnw, "ETNW now in the gate");
    assert.equal(etnw!.golden, 1230675 - 30000); // equity − intangibles
    assert.equal(etnw!.classification, "ZERO");
    assert.ok(val.checks.some((c) => c.metric === "DEBT_TO_ETNW"));
  });
});
