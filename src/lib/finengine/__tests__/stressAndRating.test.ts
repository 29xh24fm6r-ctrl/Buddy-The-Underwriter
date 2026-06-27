import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stressC, revenueCompressionSeries, rateShock, runStressBattery, type StressInputs } from "@/lib/finengine/stress/stressEngine";
import { rateRisk, computePD, computeLGD } from "@/lib/finengine/riskRating";

const base: StressInputs = {
  baseCashFlow: 300_000,
  baseRevenue: 2_000_000,
  grossMarginPct: 0.5,
  debtService: 200_000,
  debtServiceStressed300: 230_000,
};

describe("Stress C — revenue-compression half present and binding (V4.2)", () => {
  it("combines +300bps AND 15% revenue compression, min 1.00x", () => {
    const r = stressC(base);
    // revenue impact = 2,000,000 * 0.15 * 0.5 = 150,000 → cf 150,000; ds 230,000 → 0.652x
    assert.equal(r.stressedCashFlow, 150_000);
    assert.equal(r.stressedDebtService, 230_000);
    assert.ok((r.dscr ?? 0) < 1.0);
    assert.equal(r.passes, false); // fails the 1.00x binding gate
    assert.match(r.scenario, /stress_c/);
  });

  it("revenue-compression series spans −5..−30%", () => {
    const s = revenueCompressionSeries(base);
    assert.deepEqual(s.map((x) => x.scenario), [
      "revenue_compression_5pct",
      "revenue_compression_10pct",
      "revenue_compression_15pct",
      "revenue_compression_20pct",
      "revenue_compression_30pct",
    ]);
  });

  it("rate shock applies +300bps on fully-amortizing debt service", () => {
    const r = rateShock(base);
    assert.equal(r.stressedDebtService, 230_000);
    assert.match(r.scenario, /rate_up_300bps/);
  });

  it("battery includes rate shock, the full series, and Stress C", () => {
    const battery = runStressBattery(base);
    assert.ok(battery.some((b) => b.scenario === "stress_c_binding"));
    assert.equal(battery.length, 1 + 5 + 1);
  });
});

describe("dual PD/LGD risk rating", () => {
  it("strong obligor + well-secured → Pass, low LGD", () => {
    const r = rateRisk({ dscr: 1.8, leverage: 2.0 }, { collateralCoverage: 1.4 });
    assert.equal(r.classification, "PASS");
    assert.ok(r.pd.grade <= 5);
    assert.ok(r.lgd.lgd <= 0.2);
  });

  it("forward-looking downgrade: graded on the lower projected DSCR", () => {
    const r = rateRisk({ dscr: 1.4, projectedDscr: 0.95, leverage: 3.0 }, { collateralCoverage: 1.1 });
    assert.ok(r.pd.grade >= 7, `expected substandard-ish, got ${r.pd.grade}`);
    assert.ok(["SUBSTANDARD", "DOUBTFUL"].includes(r.classification));
    assert.ok(r.rationale.some((x) => /Forward-looking/.test(x)));
  });

  it("junior lien + thin coverage raises LGD", () => {
    const lo = computeLGD({ collateralCoverage: 1.3, lienPosition: 1 });
    const hi = computeLGD({ collateralCoverage: 0.7, lienPosition: 2 });
    assert.ok(hi.lgd > lo.lgd);
  });

  it("PD overlays leverage and trend", () => {
    const clean = computePD({ dscr: 1.5, leverage: 2.0 });
    const levered = computePD({ dscr: 1.5, leverage: 9.0, deterioratingTrend: true });
    assert.ok(levered.grade > clean.grade);
  });

  it("rationale states the grade is deterministic (NG1 — Omega narrates, never sets)", () => {
    const r = rateRisk({ dscr: 1.5, leverage: 2.0 }, { collateralCoverage: 1.4 });
    assert.ok(r.rationale.some((x) => /deterministic/.test(x)));
  });
});
