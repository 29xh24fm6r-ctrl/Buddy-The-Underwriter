import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const {
  redactSBAPackageForPreview,
  redactFeasibilityForPreview,
  redactFeasibilityDetailForPreview,
  redactMonthlyProjectionsForPreview,
  redactBreakEvenForPreview,
  redactSensitivityScenariosForPreview,
  redactRevenueStreamProjectionsForPreview,
  REDACTOR_VERSION,
} = require("../redactor") as typeof import("../redactor");

function sampleSBAInputs() {
  return {
    dealName: "Samaritus Management LLC",
    loanType: "SBA",
    loanAmount: 487_250,
    baseYear: {
      revenue: 1_482_733,
      cogs: 741_366,
      operatingExpenses: 297_000,
      ebitda: 444_367,
      depreciation: 23_000,
      netIncome: 421_367,
      totalDebtService: 48_000,
    },
    annualProjections: [
      {
        year: 1,
        revenue: 1_632_500,
        dscr: 1.47,
        totalDebtService: 58_200,
        ebitda: 487_250,
      },
    ],
    executiveSummary:
      "This is the full executive summary with every detail you could want including the borrower's specific location in Cleveland and their prior employer Smith Industries.",
    industryAnalysis: "",
    marketingStrategy: "",
    operationsPlan: "",
    swotStrengths: "",
    swotWeaknesses: "",
    swotOpportunities: "",
    swotThreats: "",
    businessOverviewNarrative: "",
    sensitivityNarrative: "",
    useOfProceeds: [
      { category: "equipment", amount: 250_000, description: "espresso machines" },
    ],
    sourcesAndUses: { loan: 487_250, equity: 100_000 },
    planThesis: "Acquire an existing profitable coffee shop.",
  };
}

test("REDACTOR_VERSION is a semver string", () => {
  assert.ok(REDACTOR_VERSION);
  assert.match(REDACTOR_VERSION, /^\d+\.\d+\.\d+$/);
});

test("loan amount bucketed to $25K (nearest-bucket round)", () => {
  const r = redactSBAPackageForPreview(sampleSBAInputs());
  // 487_250 / 25_000 = 19.49 → round to 19 → 475_000
  assert.equal(r.loanAmount, 475_000);
});

test("base-year revenue bucketed to $25K", () => {
  const r = redactSBAPackageForPreview(sampleSBAInputs());
  assert.equal(r.baseYear.revenue, 1_475_000);
});

test("DSCR preserved to one decimal (preview signal)", () => {
  const r = redactSBAPackageForPreview(sampleSBAInputs());
  assert.equal(r.annualProjections[0].dscr, 1.5);
});

test("narratives: replaced with teaser + unlock placeholder", () => {
  const r = redactSBAPackageForPreview(sampleSBAInputs());
  assert.ok(r.executiveSummary.includes("[Unlocks when you pick a lender]"));
  assert.ok(r.executiveSummary.length < 500);
});

test("use-of-proceeds: amounts zeroed, descriptions placeholder'd, category preserved", () => {
  const r = redactSBAPackageForPreview(sampleSBAInputs());
  for (const item of r.useOfProceeds) {
    assert.equal(item.amount, 0);
    assert.equal(item.description, "[Unlocks when you pick a lender]");
    assert.ok(item.category); // category survives
  }
});

test("sources_and_uses: opaqued", () => {
  const r = redactSBAPackageForPreview(sampleSBAInputs());
  assert.deepEqual(r.sourcesAndUses, {
    preview: true,
    message: "[Unlocks when you pick a lender]",
  });
});

test("plan thesis survives (high-level framing is allowed)", () => {
  const r = redactSBAPackageForPreview(sampleSBAInputs());
  assert.equal(r.planThesis, "Acquire an existing profitable coffee shop.");
});

test("serialization check: zero precise borrower numbers leak", () => {
  const inputs = sampleSBAInputs();
  const r = redactSBAPackageForPreview(inputs);
  const serialized = JSON.stringify(r);

  // Every exact number from the inputs that should NOT survive.
  const preciseBlacklist = [
    1_482_733,
    741_366,
    297_000, // bucket: 300_000 — actually this is already clean by bucket; it's a boundary value; 297000 bucketed to 25K = 300_000 ≠ 297_000
    444_367,
    421_367,
    487_250, // loan amount AND year-1 ebitda — two places; both must bucket
    1_632_500,
    58_200,
    250_000, // uop amount — zeroed
  ];
  for (const n of preciseBlacklist) {
    assert.equal(
      serialized.includes(String(n)),
      false,
      `precise number ${n} leaked into redacted output: ${serialized.slice(0, 400)}`,
    );
  }

  // The borrower-identifying placenames / entity names from the summary
  // also should not appear past the 180-char teaser cut.
  const teaser = inputs.executiveSummary.slice(0, 180);
  if (!teaser.includes("Cleveland")) {
    assert.equal(
      serialized.includes("Cleveland"),
      false,
      "Cleveland identifier leaked past teaser",
    );
  }
  if (!teaser.includes("Smith Industries")) {
    assert.equal(
      serialized.includes("Smith Industries"),
      false,
      "Smith Industries identifier leaked past teaser",
    );
  }
});

test("feasibility scores pass through; narratives are replaced", () => {
  const r = redactFeasibilityForPreview({
    compositeScore: 73,
    marketDemandScore: 80,
    financialViabilityScore: 65,
    operationalReadinessScore: 70,
    locationSuitabilityScore: 75,
    narratives: {
      market_demand:
        "A long narrative that leaks specifics about the borrower's market position in Cleveland.",
    },
  });
  assert.equal(r.compositeScore, 73);
  assert.equal(r.marketDemandScore, 80);
  assert.equal(r.financialViabilityScore, 65);
  assert.ok(
    r.narratives.market_demand.toLowerCase().includes("unlocks when you pick"),
  );
  assert.equal(r.narratives.market_demand.includes("Cleveland"), false);
});

test("empty narrative uses fallback text", () => {
  const r = redactSBAPackageForPreview({
    ...sampleSBAInputs(),
    industryAnalysis: "",
  });
  assert.equal(r.industryAnalysis, "Industry analysis is complete.");
});

test("roundToBucket: zero stays zero, non-finite → 0", () => {
  // Indirect test: a zero input should stay zero after redaction.
  const inputs = sampleSBAInputs();
  inputs.baseYear.depreciation = 0;
  const r = redactSBAPackageForPreview(inputs);
  assert.equal(r.baseYear.depreciation, 0);
});

// ── Feasibility dimension details (audit F-03) ──────────────────────────────
// These trees reach the PDF renderer verbatim (renderDimensionDetail /
// renderFlagList) and interpolate exact borrower figures. Before this fix the
// preview redactor touched only `narratives`, so the "zero precise borrower
// numbers" contract at the top of redactor.ts did not actually hold.

function sampleFinancialViabilityDetail() {
  return {
    overallScore: 71,
    debtServiceCoverage: {
      score: 78,
      weight: 0.3,
      dataSource: "SBA projection model — DSCR",
      dataAvailable: true,
      detail: "Year 1 DSCR: 1.42x. The business covers debt service comfortably.",
    },
    breakEvenMargin: {
      score: 64,
      weight: 0.2,
      dataSource: "SBA projection model — break-even analysis",
      dataAvailable: true,
      detail:
        "Margin of safety: 23.4%. Projected revenue exceeds break-even by $487,250.",
    },
    flags: [
      {
        severity: "warning",
        dimension: "Financial viability",
        message: "Working capital reserve of 1.8 months is below the 3-month guideline.",
      },
    ],
  };
}

test("feasibility detail redaction removes every precise borrower figure", () => {
  const r = redactFeasibilityDetailForPreview(sampleFinancialViabilityDetail());
  const serialized = JSON.stringify(r);
  for (const leak of ["487,250", "1.42x", "23.4%", "1.8 months"]) {
    assert.equal(serialized.includes(leak), false, `preview leaked ${leak}`);
  }
});

test("feasibility detail redaction preserves the preview signal", () => {
  const r = redactFeasibilityDetailForPreview(sampleFinancialViabilityDetail()) as any;
  // Scores ARE the preview signal per the S3-1 contract — they survive.
  assert.equal(r.overallScore, 71);
  assert.equal(r.debtServiceCoverage.score, 78);
  assert.equal(r.debtServiceCoverage.weight, 0.3);
  assert.equal(r.debtServiceCoverage.dataAvailable, true);
  // Traceability strings carry no borrower values and survive.
  assert.equal(r.debtServiceCoverage.dataSource, "SBA projection model — DSCR");
  // Flag severity and dimension survive; only the message text is replaced.
  assert.equal(r.flags[0].severity, "warning");
  assert.equal(r.flags[0].dimension, "Financial viability");
  assert.ok(r.flags[0].message.includes("Unlocks when you pick a lender"));
});

test("feasibility detail redaction is structure-preserving and total", () => {
  const r = redactFeasibilityDetailForPreview({
    nested: { deep: [{ detail: "Equity injection: 12.5%." }] },
    untouched: 42,
  }) as any;
  assert.equal(r.untouched, 42);
  assert.equal(r.nested.deep[0].detail.includes("12.5%"), false);
  assert.ok(r.nested.deep[0].detail.includes("Unlocks when you pick a lender"));
});

test("REDACTOR_VERSION was bumped for the detail-layer change", () => {
  assert.notEqual(REDACTOR_VERSION, "1.0.0");
});

// ── SBA projection detail (audit F-13) ─────────────────────────────────────
// The SBA package renderer prints these structures verbatim. Before this fix
// the orchestrator passed them through raw in preview mode, so the preview
// business plan carried every month of exact cash flow and an exact
// "Projected Year 1 Revenue" line that contradicted the bucketed value the
// projections table showed a few pages earlier.

const EXACT_Y1_REVENUE = 487_250;

function sampleMonths() {
  return [
    {
      month: 1,
      revenue: 41_270,
      operatingDisbursements: 33_910,
      netOperatingCF: 7_360,
      debtService: 4_812,
      netCash: 2_548,
      cumulativeCash: 2_548,
    },
    {
      month: 2,
      revenue: 39_845,
      operatingDisbursements: 34_105,
      netOperatingCF: 5_740,
      debtService: 4_812,
      netCash: 928,
      cumulativeCash: 3_476,
      workingCapitalChange: 1_237,
    },
  ];
}

function sampleBreakEven() {
  return {
    fixedCostsAnnual: 268_430,
    contributionMarginPct: 0.42,
    breakEvenRevenue: 639_119,
    breakEvenUnits: null,
    projectedRevenueYear1: EXACT_Y1_REVENUE,
    marginOfSafetyPct: 0.234,
    flagLowMargin: false,
  };
}

test("monthly projections lose precision but keep their shape", () => {
  const r = redactMonthlyProjectionsForPreview(sampleMonths());
  const serialized = JSON.stringify(r);
  for (const leak of ["41270", "33910", "4812", "2548", "3476", "1237"]) {
    assert.equal(serialized.includes(leak), false, `preview leaked ${leak}`);
  }
  assert.equal(r.length, 2);
  assert.equal(r[0].month, 1, "month index is structure, not a borrower figure");
  assert.equal(r[1].month, 2);
  // Optional members are preserved when present and not invented when absent.
  assert.equal("workingCapitalChange" in r[0], false);
  assert.equal("workingCapitalChange" in r[1], true);
});

test("break-even loses dollar precision and keeps every ratio", () => {
  const r = redactBreakEvenForPreview(sampleBreakEven());
  assert.equal(JSON.stringify(r).includes("487250"), false, "exact Y1 revenue leaked");
  assert.equal(JSON.stringify(r).includes("639119"), false, "exact break-even revenue leaked");
  assert.equal(JSON.stringify(r).includes("268430"), false, "exact fixed costs leaked");
  // Ratios and verdicts are the preview signal.
  assert.equal(r.contributionMarginPct, 0.42);
  assert.equal(r.marginOfSafetyPct, 0.234);
  assert.equal(r.flagLowMargin, false);
  assert.equal(r.breakEvenUnits, null);
});

test("the document cannot contradict itself about Year 1 revenue", () => {
  // The regression in one line: the projections table bucketed Year 1 revenue
  // to $25K while the break-even section printed it exactly. Both paths must
  // now land on the same number.
  const fromProjectionsTable = redactSBAPackageForPreview({
    ...sampleSBAInputs(),
    annualProjections: [
      { year: 1, revenue: EXACT_Y1_REVENUE, dscr: 1.42, totalDebtService: 57_744, ebitda: 121_800 },
    ],
  }).annualProjections[0].revenue;

  const fromBreakEvenSection = redactBreakEvenForPreview(sampleBreakEven()).projectedRevenueYear1;

  assert.equal(
    fromBreakEvenSection,
    fromProjectionsTable,
    "the same figure must render identically in both sections of one preview",
  );
  assert.notEqual(fromBreakEvenSection, EXACT_Y1_REVENUE);
});

test("sensitivity scenarios keep their verdict and lose exact revenue", () => {
  const r = redactSensitivityScenariosForPreview([
    {
      name: "downside",
      label: "Downside",
      revenueGrowthAdjustment: -0.15,
      cogsAdjustment: 0.05,
      dscrYear1: 1.1834,
      dscrYear2: 1.2671,
      dscrYear3: 1.3492,
      revenueYear1: 414_162,
      ebitdaMarginYear1: 0.187,
      passesSBAThreshold: false,
    },
  ]);
  assert.equal(JSON.stringify(r).includes("414162"), false);
  assert.equal(r[0].name, "downside");
  assert.equal(r[0].passesSBAThreshold, false);
  assert.equal(r[0].ebitdaMarginYear1, 0.187);
  // DSCR keeps one decimal — the same treatment annual projections get.
  assert.equal(r[0].dscrYear1, 1.2);
  assert.equal(r[0].dscrYear3, 1.3);
});

test("revenue streams keep identity and growth, lose dollar precision", () => {
  const r = redactRevenueStreamProjectionsForPreview([
    {
      id: "rs-1",
      name: "Precision machining contracts",
      pricingModel: "per_unit",
      baseAnnualRevenue: 312_480,
      growthRateYear1: 0.12,
      growthRateYear2: 0.09,
      growthRateYear3: 0.07,
      revenueYear1: 349_978,
      revenueYear2: 381_476,
      revenueYear3: 408_179,
    },
  ]);
  const serialized = JSON.stringify(r);
  for (const leak of ["312480", "349978", "381476", "408179"]) {
    assert.equal(serialized.includes(leak), false, `preview leaked ${leak}`);
  }
  assert.equal(r[0].name, "Precision machining contracts");
  assert.equal(r[0].growthRateYear1, 0.12);
});

test("REDACTOR_VERSION was bumped for the SBA projection-detail change", () => {
  assert.notEqual(REDACTOR_VERSION, "1.1.0");
  assert.match(REDACTOR_VERSION, /^\d+\.\d+\.\d+$/);
});
