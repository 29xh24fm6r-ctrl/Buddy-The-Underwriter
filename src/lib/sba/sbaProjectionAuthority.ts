import type { SBAAssumptions, AnnualProjectionYear, UseOfProceedsLine } from "./sbaReadinessTypes";
import { buildProjectionLedger } from "./sbaProjectionLedger";
import { buildBalanceSheetProjections, type BalanceSheetBaseYearInputs } from "./sbaBalanceSheetProjector";
import {
  buildAnnualProjections,
  buildMonthlyProjections,
  buildRevenueStreamProjections,
  computeBreakEven,
  buildSensitivityScenarios,
} from "./sbaForwardModelBuilder";

/**
 * Versioned authority boundary for every borrower-facing SBA projection.
 *
 * Consumers receive one immutable projection model instead of independently
 * invoking the annual, monthly, revenue-stream, break-even, and sensitivity
 * calculators. The lower-level builders remain pure implementation details;
 * artifact and UI code must consume this model.
 */
// v5: one closing/debt/asset ledger reconciles P&L, liquidity and balances.
export const SBA_PROJECTION_ENGINE_VERSION = "sba_projection_v5" as const;

export type SBAProjectionModel = {
  engineVersion: typeof SBA_PROJECTION_ENGINE_VERSION;
  generatedFrom: "borrower_confirmed_assumptions";
  baseYear: AnnualProjectionYear;
  annualProjections: ReturnType<typeof buildAnnualProjections>;
  monthlyProjections: ReturnType<typeof buildMonthlyProjections>;
  revenueStreamProjections: ReturnType<typeof buildRevenueStreamProjections>;
  breakEven: ReturnType<typeof computeBreakEven>;
  sensitivityScenarios: ReturnType<typeof buildSensitivityScenarios>;
  balanceSheetProjections: ReturnType<typeof buildBalanceSheetProjections>;
  accountingBasis: string[];
  accountingBlockers: string[];
};

export type SBAProjectionBasis = {
  baseYear: AnnualProjectionYear;
  openingBalance: BalanceSheetBaseYearInputs;
  useOfProceeds: UseOfProceedsLine[];
  projectedDscrThreshold?: number;
};

export function computeSBAProjectionModel(args: {
  assumptions: SBAAssumptions;
  baseYear: AnnualProjectionYear;
  projectedDscrThreshold?: number;
  useOfProceeds?: UseOfProceedsLine[];
  /** Governed CASH fact. Seeds the monthly cash balance; see buildMonthlyProjections. */
  openingCash?: number;
  openingBalance?: BalanceSheetBaseYearInputs;
}): SBAProjectionModel {
  const { assumptions, baseYear, projectedDscrThreshold, useOfProceeds = [], openingCash = 0, openingBalance } = args;
  const ledger = buildProjectionLedger({ assumptions, baseYear, useOfProceeds, opening: openingBalance });
  const annualProjections = buildAnnualProjections(assumptions, baseYear, ledger);
  const year1 = annualProjections[0];

  if (!year1) {
    throw new Error("SBA projection engine produced no Year 1 projection");
  }

  const monthlyProjections = buildMonthlyProjections(assumptions, year1, useOfProceeds, openingBalance?.cash ?? openingCash, ledger);
  const balanceSheetProjections = openingBalance ? buildBalanceSheetProjections(assumptions, annualProjections, openingBalance, {
    ledger, year1EndingCash: monthlyProjections.at(-1)?.cumulativeCash, year1EndingWorkingCapital: monthlyProjections.at(-1),
  }) : [];
  return Object.freeze({
    engineVersion: SBA_PROJECTION_ENGINE_VERSION,
    generatedFrom: "borrower_confirmed_assumptions",
    baseYear,
    annualProjections,
    monthlyProjections,
    balanceSheetProjections,
    accountingBasis: ledger.basis,
    accountingBlockers: ledger.blockers,
    revenueStreamProjections: buildRevenueStreamProjections(assumptions),
    breakEven: computeBreakEven(assumptions, year1),
    sensitivityScenarios: buildSensitivityScenarios(
      assumptions,
      [baseYear, ...annualProjections],
      projectedDscrThreshold,
      ledger,
    ),
  });
}
