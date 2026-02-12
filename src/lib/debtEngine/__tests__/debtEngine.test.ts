/**
 * Debt Engine — Phase 4C Tests
 *
 * ~14 tests covering amortization, IO, balloon, portfolio aggregation,
 * period alignment, and integration with CreditSnapshot.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { DebtInstrument } from "../types";
import { computeAnnualDebtService } from "../amortization";
import { computeDebtPortfolioService } from "../portfolio";
import { alignDebtServiceToPeriod } from "../periodAlignment";
import { computeCreditSnapshot } from "@/lib/creditMetrics";
import type { FinancialModel } from "@/lib/modelEngine/types";

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const STANDARD_5YR: DebtInstrument = {
  id: "loan-5yr",
  source: "proposed",
  principal: 500_000,
  rate: 0.065, // 6.5%
  amortizationMonths: 60, // 5 years
  paymentFrequency: "monthly",
};

const STANDARD_10YR: DebtInstrument = {
  id: "loan-10yr",
  source: "existing",
  principal: 1_000_000,
  rate: 0.055, // 5.5%
  amortizationMonths: 120, // 10 years
  paymentFrequency: "monthly",
};

const IO_LOAN: DebtInstrument = {
  id: "loan-io",
  source: "proposed",
  principal: 750_000,
  rate: 0.07, // 7%
  amortizationMonths: 300, // 25 years
  interestOnlyMonths: 12,
  paymentFrequency: "monthly",
};

const BALLOON_LOAN: DebtInstrument = {
  id: "loan-balloon",
  source: "existing",
  principal: 2_000_000,
  rate: 0.06, // 6%
  amortizationMonths: 300, // 25-year amortization
  termMonths: 84, // 7-year term (balloon at maturity)
  balloon: true,
  paymentFrequency: "monthly",
};

const QUARTERLY_LOAN: DebtInstrument = {
  id: "loan-quarterly",
  source: "existing",
  principal: 400_000,
  rate: 0.05, // 5%
  amortizationMonths: 60, // 5 years
  paymentFrequency: "quarterly",
};

const ZERO_RATE_LOAN: DebtInstrument = {
  id: "loan-zero-rate",
  source: "proposed",
  principal: 120_000,
  rate: 0,
  amortizationMonths: 60,
  paymentFrequency: "monthly",
};

const INVALID_LOAN: DebtInstrument = {
  id: "loan-invalid",
  source: "existing",
  principal: -100_000,
  rate: 0.05,
  amortizationMonths: 60,
  paymentFrequency: "monthly",
};

// Model for integration tests
const MODEL_WITH_INTEREST: FinancialModel = {
  dealId: "deal-integration",
  periods: [
    {
      periodId: "p-fye-2024",
      periodEnd: "2024-12-31",
      type: "FYE",
      income: { revenue: 1_000_000, interest: 120_000, netIncome: 230_000 },
      balance: {
        cash: 150_000,
        accountsReceivable: 80_000,
        inventory: 60_000,
        shortTermDebt: 100_000,
        longTermDebt: 500_000,
      },
      cashflow: { ebitda: 400_000 },
      qualityFlags: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// Amortization Tests (6)
// ---------------------------------------------------------------------------

describe("Amortization Engine", () => {
  it("5-year standard amort computes correct annual DS", () => {
    const result = computeAnnualDebtService(STANDARD_5YR);
    assert.ok(result.annualDebtService !== undefined);
    assert.ok(result.periodicDebtService !== undefined);

    // PMT(500000, 0.065/12, 60) ≈ $9,783.07/mo → $117,396.89/yr
    const monthlyPayment = result.periodicDebtService!;
    assert.ok(Math.abs(monthlyPayment - 9783.07) < 1);
    assert.ok(Math.abs(result.annualDebtService! - monthlyPayment * 12) < 0.01);

    // P&I breakdown should sum to annual DS
    assert.ok(result.breakdown.principal !== undefined);
    assert.ok(result.breakdown.interest !== undefined);
    assert.ok(
      Math.abs(
        result.breakdown.principal! + result.breakdown.interest! - result.annualDebtService!,
      ) < 0.01,
    );
  });

  it("10-year standard amort computes correct annual DS", () => {
    const result = computeAnnualDebtService(STANDARD_10YR);
    assert.ok(result.annualDebtService !== undefined);

    // PMT(1000000, 0.055/12, 120) ≈ $10,852.79/mo → $130,233.48/yr
    const monthlyPayment = result.periodicDebtService!;
    assert.ok(Math.abs(monthlyPayment - 10852.79) < 1);
  });

  it("IO loan notes IO period in diagnostics, returns post-IO DS", () => {
    const result = computeAnnualDebtService(IO_LOAN);
    assert.ok(result.annualDebtService !== undefined);
    assert.ok(result.diagnostics?.notes?.some((n) => n.includes("IO period")));

    // Post-IO amortizing payment: PMT(750000, 0.07/12, 300)
    // ≈ $5,300.84/mo → $63,610.13/yr
    const monthlyPayment = result.periodicDebtService!;
    assert.ok(Math.abs(monthlyPayment - 5300.84) < 1);
  });

  it("balloon loan excludes balloon from DS, notes in diagnostics", () => {
    const result = computeAnnualDebtService(BALLOON_LOAN);
    assert.ok(result.annualDebtService !== undefined);
    assert.ok(result.diagnostics?.notes?.some((n) => n.includes("Balloon")));

    // PMT(2000000, 0.06/12, 300) ≈ $12,886.03/mo → $154,632.34/yr
    const monthlyPayment = result.periodicDebtService!;
    assert.ok(Math.abs(monthlyPayment - 12886.03) < 1);
  });

  it("quarterly payments compute correct annual DS", () => {
    const result = computeAnnualDebtService(QUARTERLY_LOAN);
    assert.ok(result.annualDebtService !== undefined);

    // PMT(400000, 0.05/4, 20) ≈ $24,024.02/qtr → $96,096.09/yr
    const qtrPayment = result.periodicDebtService!;
    assert.ok(Math.abs(result.annualDebtService! - qtrPayment * 4) < 0.01);
  });

  it("zero rate loan returns pure principal repayment", () => {
    const result = computeAnnualDebtService(ZERO_RATE_LOAN);
    assert.ok(result.annualDebtService !== undefined);
    // 120,000 / 60 months = $2,000/mo = $24,000/yr
    assert.ok(Math.abs(result.annualDebtService! - 24_000) < 0.01);
    assert.ok(Math.abs(result.breakdown.interest! - 0) < 0.01);
  });

  it("determinism: same input → same output", () => {
    const a = computeAnnualDebtService(STANDARD_5YR);
    const b = computeAnnualDebtService(STANDARD_5YR);
    assert.deepEqual(a, b);
  });

  it("negative principal returns unsupportedStructure", () => {
    const result = computeAnnualDebtService(INVALID_LOAN);
    assert.equal(result.annualDebtService, undefined);
    assert.ok(result.diagnostics?.unsupportedStructure);
  });

  it("zero principal returns zero DS", () => {
    const zeroLoan: DebtInstrument = { ...STANDARD_5YR, id: "zero", principal: 0 };
    const result = computeAnnualDebtService(zeroLoan);
    assert.equal(result.annualDebtService, 0);
    assert.equal(result.periodicDebtService, 0);
  });
});

// ---------------------------------------------------------------------------
// Portfolio Aggregation Tests (3)
// ---------------------------------------------------------------------------

describe("Portfolio Aggregation", () => {
  it("aggregates multiple instruments correctly", () => {
    const result = computeDebtPortfolioService([STANDARD_5YR, STANDARD_10YR]);
    assert.ok(result.totalAnnualDebtService !== undefined);

    const ds5yr = computeAnnualDebtService(STANDARD_5YR).annualDebtService!;
    const ds10yr = computeAnnualDebtService(STANDARD_10YR).annualDebtService!;

    assert.ok(Math.abs(result.totalAnnualDebtService! - (ds5yr + ds10yr)) < 0.01);
    assert.ok(result.instrumentBreakdown["loan-5yr"]);
    assert.ok(result.instrumentBreakdown["loan-10yr"]);
  });

  it("invalid instruments tracked in diagnostics, valid still aggregated", () => {
    const result = computeDebtPortfolioService([STANDARD_5YR, INVALID_LOAN]);
    assert.ok(result.totalAnnualDebtService !== undefined);
    assert.ok(result.diagnostics?.invalidInstruments?.includes("loan-invalid"));

    // Should still include the valid instrument
    const ds5yr = computeAnnualDebtService(STANDARD_5YR).annualDebtService!;
    assert.ok(Math.abs(result.totalAnnualDebtService! - ds5yr) < 0.01);
  });

  it("empty portfolio returns undefined total", () => {
    const result = computeDebtPortfolioService([]);
    assert.equal(result.totalAnnualDebtService, undefined);
  });

  it("determinism: same inputs → same output", () => {
    const a = computeDebtPortfolioService([STANDARD_5YR, QUARTERLY_LOAN]);
    const b = computeDebtPortfolioService([STANDARD_5YR, QUARTERLY_LOAN]);
    assert.deepEqual(a, b);
  });
});

// ---------------------------------------------------------------------------
// Period Alignment Tests (2)
// ---------------------------------------------------------------------------

describe("Period Alignment", () => {
  it("FYE uses full annual DS", () => {
    const portfolio = computeDebtPortfolioService([STANDARD_5YR]);
    const aligned = alignDebtServiceToPeriod(portfolio, "FYE");
    assert.equal(aligned.alignmentType, "FY");
    assert.equal(aligned.annualDebtService, portfolio.totalAnnualDebtService);
  });

  it("YTD notes no proration in Phase 4C", () => {
    const portfolio = computeDebtPortfolioService([STANDARD_5YR]);
    const aligned = alignDebtServiceToPeriod(portfolio, "YTD");
    assert.equal(aligned.alignmentType, "INTERIM");
    assert.ok(aligned.diagnostics?.notes?.some((n) => n.includes("No proration")));
    // Still uses full annual DS
    assert.equal(aligned.annualDebtService, portfolio.totalAnnualDebtService);
  });
});

// ---------------------------------------------------------------------------
// Integration: CreditSnapshot with instruments (3)
// ---------------------------------------------------------------------------

describe("Integration: CreditSnapshot with instruments", () => {
  it("instruments replace interest-expense proxy for DSCR", () => {
    const instruments: DebtInstrument[] = [STANDARD_10YR];
    const snapshot = computeCreditSnapshot(MODEL_WITH_INTEREST, {
      strategy: "LATEST_FY",
      instruments,
    });

    assert.ok(snapshot);
    assert.equal(snapshot.debtService.diagnostics.source, "debtEngine");

    // DSCR should use debt engine DS, not interest proxy
    const engineDS = computeAnnualDebtService(STANDARD_10YR).annualDebtService!;
    const dscr = snapshot.ratios.metrics.dscr;
    assert.ok(dscr);
    assert.ok(dscr.value !== undefined);
    // EBITDA (400,000) / engineDS (~130,233)
    assert.ok(Math.abs(dscr.value! - 400_000 / engineDS) < 0.001);
  });

  it("without instruments falls back to interest proxy", () => {
    const snapshot = computeCreditSnapshot(MODEL_WITH_INTEREST, {
      strategy: "LATEST_FY",
    });

    assert.ok(snapshot);
    assert.equal(snapshot.debtService.diagnostics.source, "income.interest");
    assert.equal(snapshot.debtService.totalDebtService, 120_000);

    // DSCR = EBITDA / interest = 400,000 / 120,000 = 3.333...
    const dscr = snapshot.ratios.metrics.dscr;
    assert.ok(dscr?.value !== undefined);
    assert.ok(Math.abs(dscr!.value! - 400_000 / 120_000) < 0.001);
  });

  it("existing/proposed breakdown populated correctly", () => {
    const instruments: DebtInstrument[] = [
      { ...STANDARD_10YR, source: "existing" },
      { ...STANDARD_5YR, source: "proposed" },
    ];
    const snapshot = computeCreditSnapshot(MODEL_WITH_INTEREST, {
      strategy: "LATEST_FY",
      instruments,
    });

    assert.ok(snapshot);
    assert.ok(snapshot.debtService.breakdown.existing !== undefined);
    assert.ok(snapshot.debtService.breakdown.proposed !== undefined);

    const existingDS = computeAnnualDebtService(STANDARD_10YR).annualDebtService!;
    const proposedDS = computeAnnualDebtService(STANDARD_5YR).annualDebtService!;
    assert.ok(Math.abs(snapshot.debtService.breakdown.existing! - existingDS) < 0.01);
    assert.ok(Math.abs(snapshot.debtService.breakdown.proposed! - proposedDS) < 0.01);
  });
});
