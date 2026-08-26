import "server-only";

export type StressScenarioAssessment = "Passes" | "Marginal" | "Fails" | "N/A";

export type StressScenarioRow = {
  key: string;
  label: string;
  revenue_haircut_pct: number;
  ebitda_haircut_pct: number;
  rate_shock_bps: number;
  stressed_ebitda: number | null;
  stressed_ads: number | null;
  stressed_dscr: number | null;
  dscr_delta: number | null;
  assessment: StressScenarioAssessment;
};

export type StressTestTable = {
  baseline_dscr: number | null;
  scenarios: StressScenarioRow[];
  breakeven_ebitda_1x: number | null;
  /** Backward-compatible field name. The multiplier is policy-governed, not necessarily 1.25x. */
  breakeven_ebitda_125x: number | null;
  breakeven_revenue_1x: number | null;
  /** Deprecated compatibility alias. This is EBITDA cushion, never revenue cushion. */
  revenue_cushion_pct: number | null;
  ebitda_cushion_pct: number | null;
  policy_dscr_floor: number | null;
  policy_citation: string | null;
  inputs_certified: boolean;
  worst_case_dscr: number | null;
  narrative: string;
};

type StressInput = {
  ebitda: number | null;
  annualDebtService: number | null;
  revenue: number | null;
  grossMargin: number | null;
  dscrFloor: number | null;
  policyCitation?: string | null;
  /** False unless EBITDA and ADS are supported by governed facts. */
  inputsCertified?: boolean;
};

type ScenarioDef = {
  key: string;
  label: string;
  ebitdaHaircut: number;
  rateShockBps: number;
};

// We intentionally model EBITDA shocks, not revenue shocks. Translating a revenue
// decline into EBITDA requires a fixed/variable cost model that the memo does not own.
const SCENARIOS: ScenarioDef[] = [
  { key: "BASELINE", label: "Baseline", ebitdaHaircut: 0, rateShockBps: 0 },
  { key: "EBITDA_10_DOWN", label: "EBITDA -10%", ebitdaHaircut: 0.10, rateShockBps: 0 },
  { key: "EBITDA_20_DOWN", label: "EBITDA -20%", ebitdaHaircut: 0.20, rateShockBps: 0 },
  { key: "EBITDA_30_DOWN", label: "EBITDA -30%", ebitdaHaircut: 0.30, rateShockBps: 0 },
  { key: "RATE_PLUS_200", label: "Rate +200bps", ebitdaHaircut: 0, rateShockBps: 200 },
  { key: "RATE_PLUS_300", label: "Rate +300bps", ebitdaHaircut: 0, rateShockBps: 300 },
  { key: "COMBINED_EBITDA10_RATE200", label: "EBITDA -10% + Rate +200bps", ebitdaHaircut: 0.10, rateShockBps: 200 },
];

function assess(value: number | null, floor: number | null): StressScenarioAssessment {
  if (value === null || !Number.isFinite(value) || floor === null) return "N/A";
  if (value >= floor) return "Passes";
  if (value >= 1) return "Marginal";
  return "Fails";
}

export function buildStressTestTable(input: StressInput): StressTestTable {
  const floor = Number.isFinite(input.dscrFloor) && (input.dscrFloor ?? 0) > 0
    ? input.dscrFloor
    : null;
  const certified = input.inputsCertified === true;
  const ebitda = certified ? input.ebitda : null;
  const annualDebtService = certified ? input.annualDebtService : null;
  const baselineDscr = ebitda !== null && annualDebtService !== null && annualDebtService > 0
    ? ebitda / annualDebtService
    : null;

  const scenarios = SCENARIOS.map((scenario): StressScenarioRow => {
    const stressedEbitda = ebitda !== null ? ebitda * (1 - scenario.ebitdaHaircut) : null;
    const stressedAds = annualDebtService !== null
      ? annualDebtService * (1 + scenario.rateShockBps / 10_000)
      : null;
    const stressedDscr = stressedEbitda !== null && stressedAds !== null && stressedAds > 0
      ? stressedEbitda / stressedAds
      : null;
    return {
      key: scenario.key,
      label: scenario.label,
      revenue_haircut_pct: 0,
      ebitda_haircut_pct: scenario.ebitdaHaircut,
      rate_shock_bps: scenario.rateShockBps,
      stressed_ebitda: stressedEbitda,
      stressed_ads: stressedAds,
      stressed_dscr: stressedDscr,
      dscr_delta: stressedDscr !== null && baselineDscr !== null ? stressedDscr - baselineDscr : null,
      assessment: assess(stressedDscr, floor),
    };
  });

  const breakevenEbitda1x = annualDebtService;
  const breakevenEbitdaAtPolicy = annualDebtService !== null && floor !== null
    ? annualDebtService * floor
    : null;
  const ebitdaCushionPct = ebitda !== null && ebitda > 0 && breakevenEbitdaAtPolicy !== null
    ? ((ebitda - breakevenEbitdaAtPolicy) / ebitda) * 100
    : null;
  // Only a 1.0x revenue breakeven is exposed, and only when an explicit margin
  // proxy exists. It is never used as a policy-breach or decline claim.
  const breakevenRevenue1x = breakevenEbitda1x !== null && input.grossMargin !== null && input.grossMargin > 0
    ? breakevenEbitda1x / input.grossMargin
    : null;

  const stressed = scenarios.filter((row) => row.key !== "BASELINE" && row.stressed_dscr !== null);
  const worst = stressed.reduce<StressScenarioRow | null>(
    (current, row) => !current || (row.stressed_dscr as number) < (current.stressed_dscr as number) ? row : current,
    null,
  );

  let narrative: string;
  if (!certified) {
    narrative = "Stress analysis withheld because EBITDA or annual debt service is not supported by governed facts.";
  } else if (floor === null) {
    narrative = "Stress analysis computed without a policy assessment because no governed DSCR floor was resolved.";
  } else {
    const cushion = ebitdaCushionPct === null
      ? "EBITDA cushion could not be calculated."
      : ebitdaCushionPct > 0
        ? `EBITDA can decline approximately ${ebitdaCushionPct.toFixed(1)}% before DSCR reaches the governed ${floor.toFixed(2)}x floor.`
        : `EBITDA is at or below the governed ${floor.toFixed(2)}x DSCR floor.`;
    const worstText = worst?.stressed_dscr === null || !worst
      ? "No stressed DSCR was available."
      : `The lowest modeled DSCR is ${worst.stressed_dscr.toFixed(2)}x under ${worst.label}.`;
    narrative = `${cushion} ${worstText}`;
  }

  return {
    baseline_dscr: baselineDscr,
    scenarios,
    breakeven_ebitda_1x: breakevenEbitda1x,
    breakeven_ebitda_125x: breakevenEbitdaAtPolicy,
    breakeven_revenue_1x: breakevenRevenue1x,
    revenue_cushion_pct: null,
    ebitda_cushion_pct: ebitdaCushionPct,
    policy_dscr_floor: floor,
    policy_citation: input.policyCitation ?? null,
    inputs_certified: certified,
    worst_case_dscr: worst?.stressed_dscr ?? null,
    narrative,
  };
}
