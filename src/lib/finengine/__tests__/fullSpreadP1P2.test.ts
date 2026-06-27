import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  cashRatio, netWorkingCapital, defensiveInterval, workingCapitalToSales,
  arTurnover, daysSalesOutstanding, inventoryTurnover, daysInventoryOnHand,
  apTurnover, daysPayableOutstanding, operatingCycle, cashConversionCycle,
  assetTurnover, fixedAssetTurnover, workingCapitalTurnover,
  debtToEquity, debtToWorth, debtToAssets, liabilitiesToAssets, debtToCapital, ltdToCapital, equityRatio, equityMultiplier,
} from "@/lib/finengine/metrics/balanceSheet";
import {
  grossMargin, operatingMargin, netMargin, ebitdaMargin, pretaxMargin, operatingExpenseRatio,
  returnOnAssets, returnOnEquity, returnOnInvestedCapital, returnOnCapitalEmployed,
  dupont3, dupont5,
} from "@/lib/finengine/metrics/profitability";

const approx = (a: number | null, b: number, t = 1e-9) => assert.ok(a != null && Math.abs(a - b) <= t, `${a} ≈ ${b}`);

describe("Phase 1 — liquidity", () => {
  it("cash ratio + NWC + defensive interval + WC/sales", () => {
    approx(cashRatio(50000, 200000).value, 0.25);
    assert.equal(netWorkingCapital(500000, 300000).value, 200000);
    approx(defensiveInterval(50000, 20000, 130000, 2000).value, 100); // 200,000 / 2,000
    approx(workingCapitalToSales(200000, 1000000).value, 0.2);
  });
});

describe("Phase 1 — activity/turnover with average balances", () => {
  it("AR/inventory/AP turnover use 2-period averages", () => {
    approx(arTurnover(1200000, 100000, 140000).value, 10); // avg AR 120,000
    approx(inventoryTurnover(600000, 90000, 110000).value, 6); // avg inv 100,000
    approx(apTurnover(600000, 40000, 60000).value, 12); // avg AP 50,000
  });
  it("days metrics: DSO, DIO, DPO, operating + cash conversion cycle", () => {
    approx(daysSalesOutstanding(120000, 1200000).value, 36.5); // 0.1 * 365
    approx(daysInventoryOnHand(100000, 600000).value, (100000 / 600000) * 365);
    approx(daysPayableOutstanding(50000, 600000).value, (50000 / 600000) * 365);
    approx(operatingCycle(36.5, 60).value, 96.5);
    approx(cashConversionCycle(36.5, 60, 30).value, 66.5);
  });
  it("asset/fixed-asset/WC turnover", () => {
    approx(assetTurnover(2000000, 900000, 1100000).value, 2); // avg TA 1,000,000
    approx(fixedAssetTurnover(2000000, 400000, 600000).value, 4); // avg NFA 500,000
    approx(workingCapitalTurnover(2000000, 150000, 250000).value, 10); // avg WC 200,000
  });
});

describe("Phase 1 — balance-sheet leverage (registry caps)", () => {
  it("debt/equity, debt/worth, debt/assets resolve a cap + pass/fail", () => {
    const de = debtToEquity(900000, 300000);
    approx(de.value, 3);
    assert.equal(de.policyApplied?.direction, "cap");
    assert.equal(de.passesFloor, true); // 3.0 <= 3.0 cap
    const dw = debtToWorth(2000000, 400000); // 5.0 > 4.0 cap -> fail
    approx(dw.value, 5);
    assert.equal(dw.passesFloor, false);
    const da = debtToAssets(700000, 1000000); // 0.70 <= 0.80
    approx(da.value, 0.7);
    assert.equal(da.passesFloor, true);
  });
  it("liabilities/assets, debt/capital, LTD/capital, equity ratio + multiplier", () => {
    approx(liabilitiesToAssets(800000, 1000000).value, 0.8);
    approx(debtToCapital(600000, 400000).value, 0.6);
    approx(ltdToCapital(300000, 300000).value, 0.5);
    approx(equityRatio(400000, 1000000).value, 0.4);
    approx(equityMultiplier(1000000, 400000).value, 2.5);
  });
  it("null-safe on zero denominators", () => {
    assert.equal(debtToEquity(900000, 0).value, null);
    assert.equal(daysSalesOutstanding(120000, 0).value, null);
  });
});

describe("Phase 2 — margins & returns", () => {
  it("margins", () => {
    approx(grossMargin(400000, 1000000).value, 0.4);
    approx(operatingMargin(250000, 1000000).value, 0.25);
    approx(netMargin(100000, 1000000).value, 0.1);
    approx(ebitdaMargin(300000, 1000000).value, 0.3);
    approx(pretaxMargin(150000, 1000000).value, 0.15);
    approx(operatingExpenseRatio(150000, 1000000).value, 0.15);
  });
  it("returns use average balances", () => {
    approx(returnOnAssets(100000, 900000, 1100000).value, 0.1); // avg TA 1,000,000
    approx(returnOnEquity(100000, 380000, 420000).value, 0.25); // avg eq 400,000
    approx(returnOnInvestedCapital(120000, 1000000).value, 0.12);
    approx(returnOnCapitalEmployed(200000, 1000000).value, 0.2);
  });
});

describe("Phase 2 — DuPont reconciliation + driver attribution", () => {
  it("3-step product reconciles to directly-computed ROE", () => {
    // netMargin 0.10, assetTurnover 1.0, equityMultiplier 2.5 -> ROE 0.25
    const d = dupont3(0.1, 1.0, 2.5);
    approx(d.roe, 0.25);
  });
  it("identifies leverage as the ROE driver when the equity multiplier dominates", () => {
    const levered = dupont3(0.04, 0.9, 5.0); // thin margin, high leverage
    assert.equal(levered.driver, "leverage");
    const marginDriven = dupont3(0.25, 0.8, 1.5);
    assert.equal(marginDriven.driver, "margin");
    const efficiencyDriven = dupont3(0.05, 3.0, 1.5);
    assert.equal(efficiencyDriven.driver, "efficiency");
  });
  it("5-step reconciles to the 3-step ROE", () => {
    // taxBurden .8, interestBurden .9, operatingMargin .1389 -> netMargin ~.10; AT 1.0; EM 2.5
    const d5 = dupont5({ netIncome: 100000, pretaxIncome: 125000, ebit: 138889, revenue: 1000000, assetTurnover: 1.0, equityMultiplier: 2.5 });
    const d3 = dupont3(0.1, 1.0, 2.5);
    approx(d5.roe, d3.roe!, 1e-3);
  });
});
