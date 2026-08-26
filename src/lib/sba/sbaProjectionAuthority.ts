import type { SBAAssumptions, AnnualProjectionYear, UseOfProceedsLine } from "./sbaReadinessTypes";
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
export const SBA_PROJECTION_ENGINE_VERSION = "sba_projection_v3" as const;

export type SBAProjectionModel = {
  engineVersion: typeof SBA_PROJECTION_ENGINE_VERSION;
  generatedFrom: "borrower_confirmed_assumptions";
  baseYear: AnnualProjectionYear;
  annualProjections: ReturnType<typeof buildAnnualProjections>;
  monthlyProjections: ReturnType<typeof buildMonthlyProjections>;
  revenueStreamProjections: ReturnType<typeof buildRevenueStreamProjections>;
  breakEven: ReturnType<typeof computeBreakEven>;
  sensitivityScenarios: ReturnType<typeof buildSensitivityScenarios>;
};

export function computeSBAProjectionModel(args: {
  assumptions: SBAAssumptions;
  baseYear: AnnualProjectionYear;
  projectedDscrThreshold?: number;
  useOfProceeds?: UseOfProceedsLine[];
}): SBAProjectionModel {
  const { assumptions, baseYear, projectedDscrThreshold, useOfProceeds = [] } = args;
  const annualProjections = buildAnnualProjections(assumptions, baseYear);
  const year1 = annualProjections[0];

  if (!year1) {
    throw new Error("SBA projection engine produced no Year 1 projection");
  }

  return Object.freeze({
    engineVersion: SBA_PROJECTION_ENGINE_VERSION,
    generatedFrom: "borrower_confirmed_assumptions",
    baseYear,
    annualProjections,
    monthlyProjections: buildMonthlyProjections(assumptions, year1, useOfProceeds),
    revenueStreamProjections: buildRevenueStreamProjections(assumptions),
    breakEven: computeBreakEven(assumptions, year1),
    sensitivityScenarios: buildSensitivityScenarios(
      assumptions,
      [baseYear, ...annualProjections],
      projectedDscrThreshold,
    ),
  });
}
