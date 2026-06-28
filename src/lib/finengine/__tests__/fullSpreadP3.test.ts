import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  tangibleNetWorth, effectiveTangibleNetWorth, adjustedNetWorth, debtToEffectiveTNW,
  netWorthReconciliation, arDilution, fixedAssetAge, netToGrossPPE, allowanceAdequacy,
} from "@/lib/finengine/metrics/balanceSheetAdjustments";
import { altmanZPrime, altmanZDoublePrime } from "@/lib/finengine/metrics/distress";

const approx = (a: number | null, b: number, t = 1e-6) => assert.ok(a != null && Math.abs(a - b) <= t, `${a} ≈ ${b}`);

describe("Phase 3a — TNW / ETNW / adjusted net worth", () => {
  it("TNW subtracts intangibles (or goodwill only in SBA variant)", () => {
    assert.equal(tangibleNetWorth(1000000, 200000).value, 800000);
    assert.equal(tangibleNetWorth(1000000, 200000, { goodwillOnly: true, goodwill: 50000 }).value, 950000);
  });
  it("ETNW follows the verbatim formula", () => {
    // 1,000,000 + 50,000 − 80,000 − (200,000 + 30,000) + 120,000 = 860,000
    const e = effectiveTangibleNetWorth({ bookNetWorth: 1000000, minorityInterest: 50000, dueFromInsiders: 80000, intangibles: 200000, accumulatedAmortization: 30000, subordinatedDebt: 120000 });
    assert.equal(e.value, 860000);
  });
  it("adjusted net worth subtracts itemized haircuts", () => {
    const a = adjustedNetWorth(800000, { slowAR: 50000, obsoleteInventory: 30000, prepaids: 20000 });
    assert.equal(a.value, 700000);
    assert.equal(a.inputs.totalHaircuts, 100000);
  });
  it("debt/ETNW resolves the registry cap", () => {
    const d = debtToEffectiveTNW(1000000, 120000, 800000); // (1,000,000 − 120,000)/800,000 = 1.1
    approx(d.value, 1.1);
    assert.equal(d.policyApplied?.direction, "cap");
    assert.equal(d.passesFloor, true); // 1.1 <= 1.30 cap
  });
});

describe("Phase 3a — net-worth reconciliation (undisclosed-distribution detector)", () => {
  it("ties to zero on a clean walk", () => {
    // begin 500k + NI 200k − distributions 150k = 550k ending → implied = reported (150k) → residual 0
    const r = netWorthReconciliation({ beginningEquity: 500000, netIncome: 200000, reportedDistributions: 150000, endingEquity: 550000 });
    assert.equal(r.value, 0);
    assert.equal(r.inputs.impliedDistributions, 150000);
  });
  it("surfaces a seeded undisclosed distribution", () => {
    // ending only 500k (50k lower) but reported distributions still 150k → implied 200k → undisclosed 50k
    const r = netWorthReconciliation({ beginningEquity: 500000, netIncome: 200000, reportedDistributions: 150000, endingEquity: 500000 });
    assert.equal(r.value, 50000);
  });
});

describe("Phase 3a — asset-quality helpers", () => {
  it("dilution / fixed-asset age / net-to-gross / allowance adequacy", () => {
    approx(arDilution(1000000, 900000).value, 0.1);
    approx(fixedAssetAge(600000, 1000000).value, 0.6);
    approx(netToGrossPPE(400000, 1000000).value, 0.4);
    approx(allowanceAdequacy(40000, 1000000, 0.05).value, 0.8); // required 50k
  });
});

describe("Phase 3b — Altman Z′ / Z″ scores + zones", () => {
  // X1=0.2, X2=0.3, X3=0.1, equity/liab=1.0, sales/assets=1.5
  const strong = { workingCapital: 200000, retainedEarnings: 300000, ebit: 100000, totalAssets: 1000000, bookEquity: 500000, totalLiabilities: 500000, sales: 1500000 };
  it("Z′ golden score + safe zone", () => {
    const r = altmanZPrime(strong);
    // 0.717*.2 + 0.847*.3 + 3.107*.1 + 0.42*1.0 + 0.998*1.5 = 0.1434+0.2541+0.3107+0.42+1.497 = 2.6252
    approx(r.score!, 2.6252, 1e-4);
    assert.equal(r.zone, "gray"); // 1.23 < 2.6252 < 2.90
  });
  it("Z″ golden score + zone classification at the boundaries", () => {
    const r = altmanZDoublePrime(strong);
    // 6.56*.2 + 3.26*.3 + 6.72*.1 + 1.05*1.0 = 1.312+0.978+0.672+1.05 = 4.012 → safe (>2.60)
    approx(r.score!, 4.012, 1e-4);
    assert.equal(r.zone, "safe");
  });
  it("distress zone fires on a weak balance sheet", () => {
    const weak = { workingCapital: -50000, retainedEarnings: -100000, ebit: -20000, totalAssets: 1000000, bookEquity: 50000, totalLiabilities: 950000, sales: 400000 };
    assert.equal(altmanZDoublePrime(weak).zone, "distress");
  });
  it("null score when total assets absent", () => {
    assert.equal(altmanZPrime({ workingCapital: 1, retainedEarnings: 1, ebit: 1, totalAssets: 0, bookEquity: 1, totalLiabilities: 1, sales: 1 }).score, null);
  });
});
