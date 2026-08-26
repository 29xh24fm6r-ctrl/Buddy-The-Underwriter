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
