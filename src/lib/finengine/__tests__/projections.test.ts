/**
 * SPEC-FINENGINE god-tier improvement C — forward projections tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { projectForward } from "@/lib/finengine/projections/projectionEngine";

const base = { revenue: 10_000_000, ebitda: 1_500_000 }; // 15% margin

describe("forward projections — coverage trajectory", () => {
  it("grows revenue/EBITDA and computes DSCR + headroom per year against the registry floor", () => {
    const r = projectForward(base, { annualDebtService: 1_000_000 }, { years: 3, revenueGrowth: 0.05 });
    assert.equal(r.years.length, 3);
    // Year 1: revenue 10.5M, EBITDA 1.575M, DSCR 1.575
    assert.equal(r.years[0].revenue, 10_500_000);
    assert.equal(r.years[0].ebitda, 1_575_000);
    assert.equal(r.years[0].dscr, 1.58);
    assert.ok(r.covenantFloor != null);
    assert.equal(r.years[0].headroom, Math.round((1.575 - r.covenantFloor!) * 100) / 100);
    assert.equal(r.passesAllYears, true);
  });

  it("margin compression + capex erodes coverage and surfaces the first breach year", () => {
    const r = projectForward(
      base,
      { annualDebtService: 1_300_000 },
      { years: 5, revenueGrowth: 0.0, ebitdaMarginDrift: -0.02, capexPctOfRevenue: 0.03 },
    );
    // margin drifts 15% → 13% → 11% … while capex (3% of 10M = 300k) is subtracted.
    assert.ok(r.firstBreachYear != null, "a breach year is identified");
    assert.equal(r.passesAllYears, false);
    // min DSCR occurs at the last (weakest) year of the compression path.
    assert.equal(r.minDscrYear, 5);
    assert.ok(r.minDscr != null && r.minDscr < r.years[0].dscr!);
  });

  it("a rising rate path lifts floating debt service and lowers DSCR over time", () => {
    const flat = projectForward(base, { annualDebtService: 1_000_000, outstandingBalance: 8_000_000, floatingShareOfBalance: 1 }, { years: 3, revenueGrowth: 0.05 });
    const shocked = projectForward(
      base,
      { annualDebtService: 1_000_000, outstandingBalance: 8_000_000, floatingShareOfBalance: 1 },
      { years: 3, revenueGrowth: 0.05, ratePathBps: [100, 100, 100] }, // +1%/yr, cumulative
    );
    // Year 3: +300bps on 8M floating = +240k debt service → lower DSCR than the flat path.
    assert.ok(shocked.years[2].debtService > flat.years[2].debtService);
    assert.equal(shocked.years[2].debtService, 1_000_000 + Math.round(8_000_000 * 0.03));
    assert.ok((shocked.years[2].dscr ?? 9) < (flat.years[2].dscr ?? 0));
  });

  it("a tenant DSCR-floor override changes the pass/fail without code change (NG4)", () => {
    // base DSCR = 1.5M / 1.23M ≈ 1.22 — above the default floor 1.20, below a strict 1.25.
    const lenient = projectForward(base, { annualDebtService: 1_230_000 }, { years: 1, revenueGrowth: 0 });
    assert.equal(lenient.covenantFloor, 1.2);
    assert.equal(lenient.years[0].passes, true); // 1.22 ≥ 1.20
    const strict = projectForward(base, { annualDebtService: 1_230_000 }, { years: 1, revenueGrowth: 0 }, { overrides: { dscr_floor: 1.25 } });
    assert.equal(strict.covenantFloor, 1.25);
    assert.equal(strict.years[0].passes, false); // 1.22 < 1.25
  });

  it("is null-safe when debt service is zero", () => {
    const r = projectForward(base, { annualDebtService: 0 }, { years: 1, revenueGrowth: 0 });
    assert.equal(r.years[0].dscr, null);
    assert.equal(r.years[0].passes, null);
    assert.equal(r.passesAllYears, true); // no breach when undefined
  });
});
