/**
 * SPEC-FINENGINE-FULL-SPREAD-1 — §9 coverage gate.
 *
 * The contract: the engine must MEASURE and EXPLAIN every line. This test walks a
 * manifest of every metric-producing function, computes each, and asserts a
 * bidirectional mapping with the interpretation layer:
 *   1. every produced metric has an interpret() entry  (measured ⇒ explained)
 *   2. every interpret() entry is produced by a function (no orphan interpretations)
 *   3. interpret() returns a well-formed reading for each.
 *
 * Adding a metric without an interpret entry (or vice-versa) fails this gate.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import * as ratios from "@/lib/finengine/metrics/ratios";
import * as bs from "@/lib/finengine/metrics/balanceSheet";
import * as prof from "@/lib/finengine/metrics/profitability";
import * as distress from "@/lib/finengine/metrics/distress";
import * as adj from "@/lib/finengine/metrics/balanceSheetAdjustments";
import * as structural from "@/lib/finengine/metrics/structuralAnalysis";
import { interpret, interpretableMetrics } from "@/lib/finengine/metrics/interpret";

const A = { workingCapital: 200000, retainedEarnings: 300000, ebit: 100000, totalAssets: 1000000, bookEquity: 500000, totalLiabilities: 500000, sales: 1500000 };

/** Every metric-producing call in the library, computed on representative inputs. */
const MANIFEST: Array<{ metric: string }> = [
  // ratios.ts
  ratios.dscr(120000, 100000), ratios.proposedLoanCoverage(120000, 80000), ratios.globalDscr(150000, 100000),
  ratios.fccr({ cashAvailable: 200000, rent: 50000, capex: 30000, cashTaxes: 20000, distributions: 10000, fixedCharges: 120000 }),
  ratios.icr(100000, 25000), ratios.leverageTotal(900000, 300000), ratios.leverageCashNetted(900000, 50000, 300000),
  ratios.leverageSenior(600000, 300000), ratios.debtYield(120000, 1000000), ratios.ltv(750000, 1000000),
  ratios.capRate(120000, 1500000), ratios.debtToTangibleNetWorth(900000, 300000),
  ratios.currentRatio(500000, 300000), ratios.quickRatio(500000, 150000, 300000),
  // balanceSheet.ts
  bs.cashRatio(50000, 200000), bs.netWorkingCapital(500000, 300000), bs.defensiveInterval(50000, 20000, 130000, 2000),
  bs.workingCapitalToSales(200000, 1000000), bs.arTurnover(1200000, 100000, 140000), bs.daysSalesOutstanding(120000, 1200000),
  bs.inventoryTurnover(600000, 90000, 110000), bs.daysInventoryOnHand(100000, 600000), bs.apTurnover(600000, 40000, 60000),
  bs.daysPayableOutstanding(50000, 600000), bs.operatingCycle(36.5, 60), bs.cashConversionCycle(36.5, 60, 30),
  bs.assetTurnover(2000000, 900000, 1100000), bs.fixedAssetTurnover(2000000, 400000, 600000), bs.workingCapitalTurnover(2000000, 150000, 250000),
  bs.debtToEquity(900000, 300000), bs.debtToWorth(2000000, 400000), bs.debtToAssets(700000, 1000000),
  bs.liabilitiesToAssets(800000, 1000000), bs.debtToCapital(600000, 400000), bs.ltdToCapital(300000, 300000),
  bs.equityRatio(400000, 1000000), bs.equityMultiplier(1000000, 400000),
  // profitability.ts
  prof.grossMargin(400000, 1000000), prof.operatingMargin(250000, 1000000), prof.netMargin(100000, 1000000),
  prof.ebitdaMargin(300000, 1000000), prof.pretaxMargin(150000, 1000000), prof.operatingExpenseRatio(150000, 1000000),
  prof.returnOnAssets(100000, 900000, 1100000), prof.returnOnEquity(100000, 380000, 420000),
  prof.returnOnInvestedCapital(120000, 1000000), prof.returnOnCapitalEmployed(200000, 1000000),
  prof.dupont3(0.1, 1.0, 2.5),
  prof.dupont5({ netIncome: 100000, pretaxIncome: 125000, ebit: 138889, revenue: 1000000, assetTurnover: 1.0, equityMultiplier: 2.5 }),
  // distress.ts
  distress.altmanZPrime(A), distress.altmanZDoublePrime(A),
  // balanceSheetAdjustments.ts
  adj.tangibleNetWorth(1000000, 200000), adj.effectiveTangibleNetWorth({ bookNetWorth: 1000000 }),
  adj.adjustedNetWorth(800000, { slowAR: 50000 }), adj.debtToEffectiveTNW(1000000, 120000, 800000),
  adj.netWorthReconciliation({ beginningEquity: 500000, netIncome: 200000, reportedDistributions: 150000, endingEquity: 550000 }),
  adj.arDilution(1000000, 900000), adj.fixedAssetAge(600000, 1000000), adj.netToGrossPPE(400000, 1000000),
  adj.allowanceAdequacy(40000, 1000000, 0.05),
  // structuralAnalysis.ts
  structural.commonSizeBalanceSheet({ cash: 100000 }, 1000000), structural.commonSizeIncome({ cogs: 600000 }, 1000000),
  structural.horizontalAnalysis(1100000, 1000000), structural.trend([{ period: "2023", value: 100 }, { period: "2024", value: 120 }]),
  structural.growthYoY(1100000, 1000000), structural.cagr(100, 200, 3), structural.peerBenchmark(1.5, 1.2),
];

describe("§9 coverage gate — every metric is measured AND explained", () => {
  const produced = new Set(MANIFEST.map((r) => r.metric));
  const interpretable = new Set(interpretableMetrics());

  it("every produced metric has an interpretation entry", () => {
    const missing = [...produced].filter((m) => !interpretable.has(m));
    assert.deepEqual(missing, [], `metrics without interpret(): ${missing.join(", ")}`);
  });

  it("every interpretation entry is produced by a function (no orphans)", () => {
    const orphans = [...interpretable].filter((m) => !produced.has(m));
    assert.deepEqual(orphans, [], `interpret entries with no producer: ${orphans.join(", ")}`);
  });

  it("interpret() returns a well-formed reading for every result", () => {
    const ratings = new Set(["strong", "adequate", "weak", "flag", "n/a"]);
    for (const r of MANIFEST) {
      const i = interpret(r);
      assert.equal(i.metric, r.metric, `metric echoed for ${r.metric}`);
      assert.ok(i.meaning.length > 0, `meaning present for ${r.metric}`);
      assert.ok(ratings.has(i.rating), `valid rating for ${r.metric} (got ${i.rating})`);
      assert.ok(Array.isArray(i.redFlags), `redFlags array for ${r.metric}`);
    }
  });
});

describe("§7 interpretation semantics — directional + policy-aware", () => {
  it("rates a strong DSCR strong and a sub-floor DSCR a flag with a policy breach", () => {
    assert.equal(interpret(ratios.dscr(160000, 100000)).rating, "strong"); // 1.6x
    const weak = interpret(ratios.dscr(90000, 100000)); // 0.9x — below dscr_floor
    assert.equal(weak.rating, "flag");
    assert.ok(weak.redFlags.some((f) => f.includes("dscr_floor")), "policy-breach red flag fires");
  });

  it("flags leverage-driven ROE as lower quality", () => {
    const levered = interpret(prof.dupont3(0.04, 0.9, 5.0));
    assert.equal(levered.rating, "weak");
    assert.ok(levered.redFlags.length > 0, "leverage-driven ROE raises a red flag");
  });

  it("maps Altman distress zone to a flag and safe zone to strong", () => {
    const weak = { workingCapital: -50000, retainedEarnings: -100000, ebit: -20000, totalAssets: 1000000, bookEquity: 50000, totalLiabilities: 950000, sales: 400000 };
    assert.equal(interpret(distress.altmanZDoublePrime(weak)).rating, "flag");
    assert.equal(interpret(distress.altmanZDoublePrime(A)).rating, "strong");
  });

  it("surfaces an undisclosed-distribution red flag from the reconciliation", () => {
    const r = adj.netWorthReconciliation({ beginningEquity: 500000, netIncome: 200000, reportedDistributions: 150000, endingEquity: 500000 });
    const i = interpret(r);
    assert.equal(i.rating, "flag");
    assert.ok(i.redFlags.some((f) => f.toLowerCase().includes("undisclosed")));
  });

  it("treats a negative tangible net worth as a red flag", () => {
    const i = interpret(adj.tangibleNetWorth(100000, 300000)); // -200,000
    assert.ok(i.redFlags.length > 0);
  });
});
