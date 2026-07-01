/**
 * SPEC-FINENGINE-RECONCILIATION-MATRIX-1 — deal-set resolver + matrix aggregator tests.
 *
 * Proves: the resolver filters/sorts correctly; the aggregator's cutover-readiness rule
 * (full-spread + decision-core gate; global CF informational; singleCountVerified is a
 * hard block; a runner error forces a block); rollups sum; products are data-derived;
 * the un-gated global CF never fabricates a divergence; and the module imports no engine
 * compute directly (the "one engine, one gate" firewall).
 *
 * Pure: no DB; runs under `node --test --import tsx`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { resolveDealSet, type DealSetEntry } from "@/lib/finengine/shadow/reconciliationDealSet";
import {
  buildReconciliationMatrix,
  runReconciliationMatrix,
  type DealReconResult,
} from "@/lib/finengine/shadow/reconciliationMatrix";
import type { ShadowReport } from "@/lib/finengine/shadow/reconcile";
import type { CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";

// ── fixtures ─────────────────────────────────────────────────────────────────
function entry(dealId: string, over: Partial<DealSetEntry> = {}): DealSetEntry {
  return { dealId, name: `deal ${dealId}`, dealType: "CONVENTIONAL", bankId: "bank-A", stage: "underwriting", factCount: 100, ...over };
}

function rep(opts: { zero?: number; intended?: number; unexpectedKeys?: string[] }): ShadowReport {
  const divergences = (opts.unexpectedKeys ?? []).map((k) => ({
    dealId: "d", factKey: k, ownerType: "BUSINESS", fiscalPeriodEnd: "2025-12-31",
    legacyValue: 1, newValue: 2, absDelta: 1, classification: "UNEXPECTED" as const,
  }));
  const unexpected = divergences.length;
  return { total: (opts.zero ?? 0) + (opts.intended ?? 0) + unexpected, zero: opts.zero ?? 0, intended: opts.intended ?? 0, unexpected, cutoverBlocked: unexpected > 0, divergences };
}

function dealResult(over: Partial<DealReconResult> & { deal: DealSetEntry }): DealReconResult {
  return {
    analysisPeriod: "2025-12-31",
    fullSpread: rep({ intended: 2 }),
    decisionCore: rep({ intended: 2 }),
    globalDSCR: 3.2,
    singleCountVerified: true,
    warnings: [],
    cutoverBlocked: false,
    error: null,
    ...over,
  };
}

// ── resolveDealSet ────────────────────────────────────────────────────────────
describe("[rds] resolveDealSet — pure filter/sort", () => {
  const deals = [
    entry("d1", { factCount: 172 }),
    entry("d2", { factCount: 0 }), // shell
    entry("d3", { factCount: 30 }), // thin
    entry("d4", { factCount: 93, bankId: "bank-B" }),
    entry("d5", { factCount: 106, dealType: "SBA_7A" }),
  ];

  it("[rds-1] onlyPopulated + default minFacts(50) drop shells and thin deals; sort by factCount desc", () => {
    const out = resolveDealSet(deals);
    assert.deepEqual(out.map((d) => d.dealId), ["d1", "d5", "d4"]); // 172, 106, 93 ; d2(0) & d3(30) dropped
  });

  it("[rds-2] filter by dealType", () => {
    assert.deepEqual(resolveDealSet(deals, { dealType: "SBA_7A" }).map((d) => d.dealId), ["d5"]);
  });

  it("[rds-3] filter by bankId", () => {
    assert.deepEqual(resolveDealSet(deals, { bankId: "bank-B" }).map((d) => d.dealId), ["d4"]);
  });

  it("[rds-4] minFacts override + onlyPopulated=false keeps shells above the floor only", () => {
    // minFacts=0, onlyPopulated=false → everything, incl. the 0-fact shell.
    const out = resolveDealSet(deals, { minFacts: 0, onlyPopulated: false });
    assert.equal(out.length, 5);
    assert.equal(out[out.length - 1].factCount, 0); // shell sorts last
  });
});

// ── buildReconciliationMatrix ─────────────────────────────────────────────────
describe("[rmx] buildReconciliationMatrix — cutover-readiness rule (load-bearing)", () => {
  it("[rmx-1] all deals unexpected==0 + singleCountVerified → cutoverReady, no blocking deals", () => {
    const m = buildReconciliationMatrix([
      dealResult({ deal: entry("d1") }),
      dealResult({ deal: entry("d2") }),
    ]);
    assert.equal(m.verdict.cutoverReady, true);
    assert.deepEqual(m.verdict.blockingDeals, []);
    assert.equal(m.dealsRun, 2);
    assert.deepEqual(m.verdict.productsPresent, ["CONVENTIONAL"]);
    assert.deepEqual(m.verdict.banksPresent, ["bank-A"]);
  });

  it("[rmx-2] a full-spread UNEXPECTED → not ready; deal in blockingDeals with harness + offending keys", () => {
    const m = buildReconciliationMatrix([
      dealResult({ deal: entry("d1") }),
      dealResult({ deal: entry("d2"), fullSpread: rep({ unexpectedKeys: ["EBITDA"] }) }),
    ]);
    assert.equal(m.verdict.cutoverReady, false);
    const bd = m.verdict.blockingDeals.find((b) => b.dealId === "d2");
    assert.ok(bd);
    assert.equal(bd!.harness, "full-spread");
    assert.deepEqual(bd!.unexpectedKeys, ["EBITDA"]);
  });

  it("[rmx-3] singleCountVerified=false but unexpected==0 → STILL not ready (hard block)", () => {
    const m = buildReconciliationMatrix([
      dealResult({ deal: entry("d1"), singleCountVerified: false }),
    ]);
    assert.equal(m.verdict.cutoverReady, false);
    const bd = m.verdict.blockingDeals.find((b) => b.dealId === "d1");
    assert.ok(bd);
    assert.equal(bd!.harness, "global-cash-flow");
    assert.deepEqual(bd!.unexpectedKeys, ["singleCountVerified=false"]);
  });

  it("[rmx-4] a runner error forces a block (never a silent pass) (R4)", () => {
    const m = buildReconciliationMatrix([
      dealResult({ deal: entry("d1"), error: "load d1: boom", singleCountVerified: false }),
    ]);
    assert.equal(m.verdict.cutoverReady, false);
    const reasons = m.verdict.blockingDeals.filter((b) => b.dealId === "d1").map((b) => b.harness);
    assert.ok(reasons.includes("runner"));
    // error path does NOT also emit a redundant global-cash-flow block.
    assert.ok(!reasons.includes("global-cash-flow"));
  });

  it("[rmx-5] byProduct/byBank rollups sum; productsPresent reflects only run products", () => {
    const m = buildReconciliationMatrix([
      dealResult({ deal: entry("d1"), fullSpread: rep({ zero: 1, intended: 2 }), decisionCore: rep({ zero: 3, intended: 1 }) }),
      dealResult({ deal: entry("d2", { dealType: "SBA_7A", bankId: "bank-B" }), fullSpread: rep({ unexpectedKeys: ["EBITDA"] }), decisionCore: rep({ intended: 2 }) }),
    ]);
    assert.equal(m.byProduct["CONVENTIONAL"].deals, 1);
    assert.equal(m.byProduct["CONVENTIONAL"].zero, 4); // 1 + 3
    assert.equal(m.byProduct["CONVENTIONAL"].intended, 3); // 2 + 1
    assert.equal(m.byProduct["CONVENTIONAL"].cutoverBlocked, false);
    assert.equal(m.byProduct["SBA_7A"].unexpected, 1);
    assert.equal(m.byProduct["SBA_7A"].cutoverBlocked, true);
    assert.equal(m.byBank["bank-B"].unexpected, 1);
    assert.deepEqual(m.verdict.productsPresent, ["CONVENTIONAL", "SBA_7A"]);
    assert.deepEqual(m.verdict.banksPresent, ["bank-A", "bank-B"]);
  });

  it("[rmx-6] global CF is informational: a finite globalDSCR with unexpected==0 never fabricates a divergence/block (R1)", () => {
    const m = buildReconciliationMatrix([
      dealResult({ deal: entry("d1"), globalDSCR: 1.036, fullSpread: rep({ intended: 1 }), decisionCore: rep({ intended: 1 }) }),
    ]);
    assert.equal(m.verdict.cutoverReady, true);
    assert.deepEqual(m.verdict.blockingDeals, []);
    assert.equal(m.byDeal[0].globalDSCR, 1.036); // populated, but not gated
  });

  it("[rmx-7] empty deal set is NOT cutover-ready (never a vacuous pass)", () => {
    assert.equal(buildReconciliationMatrix([]).verdict.cutoverReady, false);
  });
});

// ── integration: runReconciliationMatrix over real runners ────────────────────
const GEM = "gemini_primary_v1";
function fr(fact_key: string, period: string, start: string | null, value: number, sct: string | null, owner: string): CertifiedFactRow {
  return { fact_key, fact_period_end: period, fact_period_start: start, fact_value_num: value, source_canonical_type: sct, owner_type: owner, confidence: 0.8, extractor: GEM, is_superseded: false, created_at: "2026-06-01T00:00:00Z" };
}
/** A clean OmniCare-shaped deal: annual income period, personal, debt service; NO legacy
 *  EBITDA/DSCR facts → full-spread EBITDA self-classifies INTENDED, decision-core un-gated. */
function cleanRows(): CertifiedFactRow[] {
  return [
    fr("M1_TAXABLE_INCOME", "2025-12-31", "2025-01-01", 800_000, "INCOME_STATEMENT", "DEAL"),
    fr("DEPRECIATION", "2025-12-31", "2025-01-01", 257_974, "INCOME_STATEMENT", "DEAL"),
    fr("GROSS_RECEIPTS", "2025-12-31", "2025-01-01", 28_767_069, "INCOME_STATEMENT", "DEAL"),
    fr("GROSS_PROFIT", "2025-12-31", "2025-01-01", 3_533_599, "INCOME_STATEMENT", "DEAL"),
    fr("ANNUAL_DEBT_SERVICE", "2026-06-29", "2026-06-29", 101_250, null, "DEAL"),
    fr("ANNUAL_DEBT_SERVICE_PROPOSED", "2026-06-29", "2026-06-29", 101_250, null, "DEAL"),
    fr("WAGES_W2", "2025-12-31", "2025-01-01", 310_000, "PERSONAL_TAX_RETURN", "DEAL"),
    fr("PFS_ANNUAL_DEBT_SERVICE", "2025-10-07", "2025-10-07", 19_800, "PFS", "PERSONAL"),
    fr("PFS_LIVING_EXPENSES", "2025-10-07", "2025-10-07", 19_800, "PFS", "PERSONAL"),
  ];
}

describe("[rmx] runReconciliationMatrix — end-to-end over the real runners", () => {
  it("[rmx-8] two synthetic clean deals → correct per-deal, rollup, and verdict", () => {
    const deals = [entry("aaaa1111"), entry("bbbb2222", { dealType: "SBA_7A", bankId: "bank-B", factCount: 90 })];
    const m = runReconciliationMatrix(
      deals,
      { aaaa1111: cleanRows(), bbbb2222: cleanRows() },
      { generatedAt: "2026-07-01T00:00:00Z" },
    );

    assert.equal(m.dealsRun, 2);
    assert.equal(m.generatedAt, "2026-07-01T00:00:00Z");
    for (const r of m.byDeal) {
      assert.equal(r.analysisPeriod, "2025-12-31"); // corrected annual period, not an AR-aging date
      assert.equal(r.singleCountVerified, true);
      assert.ok(r.globalDSCR != null && Number.isFinite(r.globalDSCR)); // real DSCR
      assert.equal(r.fullSpread.unexpected, 0); // EBITDA self-classifies INTENDED
      assert.equal(r.decisionCore.unexpected, 0); // no legacy DSCR → un-gated
    }
    assert.equal(m.verdict.cutoverReady, true);
    assert.deepEqual(m.verdict.blockingDeals, []);
    assert.deepEqual(m.verdict.productsPresent, ["CONVENTIONAL", "SBA_7A"]);
    assert.deepEqual(m.verdict.banksPresent, ["bank-A", "bank-B"]);
    assert.equal(m.byProduct["CONVENTIONAL"].deals, 1);
    assert.equal(m.byProduct["SBA_7A"].deals, 1);
  });

  it("[rmx-9] a deal with empty rows is handled (degrades, never throws)", () => {
    const m = runReconciliationMatrix([entry("empty000")], { empty000: [] });
    assert.equal(m.dealsRun, 1);
    // no crash; the deal produces a result (globalDSCR null, un-gated reports empty).
    assert.equal(m.byDeal[0].error, null);
  });
});

// ── source-grep guard (one engine, one gate) ──────────────────────────────────
describe("[rmx] reconciliationMatrix — no direct engine compute (firewall)", () => {
  it("[rmx-10] the aggregator orchestrates runners only; imports no engine compute", () => {
    const src = readFileSync(fileURLToPath(new URL("../shadow/reconciliationMatrix.ts", import.meta.url)), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/computeDealSpread/.test(code), "must NOT import computeDealSpread");
    assert.ok(!/computeGlobalCashFlow/.test(code), "must NOT import computeGlobalCashFlow");
    assert.ok(!/stressEngine/.test(code), "must NOT import the stress engine");
    // it DOES orchestrate the three runners.
    assert.ok(/runFullSpreadShadow/.test(code) && /runGlobalCashFlowShadow/.test(code) && /runDecisionCoreShadow/.test(code));
  });
});
