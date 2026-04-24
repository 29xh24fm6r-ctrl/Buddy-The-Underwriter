import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const Module = require("module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") {
    return path.join(process.cwd(), "node_modules/server-only/empty.js");
  }
  return origResolve.call(this, request, ...args);
};

const { redactForMarketplace, KFS_REDACTION_VERSION } =
  require("../redactForMarketplace") as typeof import("../redactForMarketplace");

function sampleInput(overrides: any = {}) {
  const base = {
    deal: {
      sba_program: "7a",
      loan_amount: 487_250,
      term_months: 120,
      state: "WI",
      use_of_proceeds: [
        { category: "equipment", amount: 250_000 },
        { category: "working capital", amount: 75_000 },
      ],
      equity_injection_amount: 123_456,
    },
    score: {
      score: 78,
      band: "selective_fit",
      rateCardTier: "widened",
      scoreComponents: {
        borrowerStrength: 4.2,
        businessStrength: 3.5,
        dealStructure: 3.8,
        repaymentCapacity: 4.0,
        franchiseQuality: null,
      },
      eligibility: {
        passed: true,
        checks: [
          { check: "for_profit", passed: true },
          { check: "size_standard", passed: true },
        ],
      },
    },
    borrower: {
      fico_score: 735,
      liquid_assets: 218_000,
      net_worth: 1_450_000,
      years_in_operation: 7,
      industry_experience_years: 12,
      industry_naics: "722511",
      industry_description: "Full-service restaurants",
    },
    financials: {
      dscr_base_historical: 1.47,
      dscr_base_projected: 1.53,
      dscr_stress_projected: 1.21,
      global_cash_flow_dscr: 1.62,
    },
    franchise: null,
    feasibility: {
      composite_score: 76,
      market_demand_score: 80,
      location_suitability_score: 72,
      financial_viability_score: 78,
      operational_readiness_score: 74,
    },
    packageManifest: {
      businessPlanPages: 24,
      projectionsPages: 8,
      feasibilityPages: 12,
      formsIncluded: ["1919", "413", "159"],
      sourceDocumentsCount: 18,
    },
  };
  return { ...base, ...overrides };
}

test("REDACTOR_VERSION is a semver string", () => {
  assert.match(KFS_REDACTION_VERSION, /^\d+\.\d+\.\d+$/);
});

test("not_eligible band throws (sealing gate must catch first)", () => {
  const input = sampleInput();
  input.score.band = "not_eligible";
  assert.throws(() => redactForMarketplace(input), /not rate-card-eligible/);
});

test("loan amount bucketed to nearest $25K", () => {
  const r = redactForMarketplace(sampleInput());
  // 487_250 / 25_000 = 19.49 → 19 → 475_000
  assert.equal(r.loanAmount, 475_000);
});

test("equity injection bucketed to nearest $10K", () => {
  const r = redactForMarketplace(sampleInput());
  // 123_456 / 10_000 = 12.3456 → 12 → 120_000
  assert.equal(r.equityInjectionAmount, 120_000);
});

test("equity injection pct computed to one decimal", () => {
  const r = redactForMarketplace(sampleInput());
  // 123_456 / 487_250 = 0.2533 → 25.3%
  assert.equal(r.equityInjectionPct, 25.3);
});

test("DSCRs preserved to one decimal", () => {
  const r = redactForMarketplace(sampleInput());
  assert.equal(r.dscrBaseProjected, 1.5);
  assert.equal(r.dscrStressProjected, 1.2);
  assert.equal(r.dscrBaseHistorical, 1.5);
  assert.equal(r.globalCashFlowDscr, 1.6);
});

test("FICO bucketed", () => {
  const cases = [
    [800, "760+"],
    [760, "760+"],
    [735, "720-760"],
    [695, "680-720"],
    [640, "<680"],
    [null, "undisclosed"],
  ];
  for (const [fico, expected] of cases) {
    const i = sampleInput();
    i.borrower.fico_score = fico as any;
    const r = redactForMarketplace(i);
    assert.equal(r.ficoBucket, expected);
  }
});

test("years-in-business bucketed", () => {
  const cases = [
    [null, "startup"],
    [0, "startup"],
    [1, "<2yr"],
    [3, "2-5yr"],
    [8, "5-10yr"],
    [15, "10+yr"],
  ];
  for (const [years, expected] of cases) {
    const i = sampleInput();
    i.borrower.years_in_operation = years as any;
    const r = redactForMarketplace(i);
    assert.equal(r.yearsInBusinessBucket, expected);
  }
});

test("franchise block: brand undisclosed when unit_count < 50", () => {
  const i = sampleInput({
    franchise: {
      brand_id: "b1",
      brand_name: "Smallville Franchise",
      brand_category: "Food Service",
      brand_unit_count: 42,
      brand_founding_year: 2018,
    },
  });
  const r = redactForMarketplace(i);
  assert.ok(r.franchiseBlock);
  assert.equal(r.franchiseBlock!.brandName, null);
  assert.equal(r.franchiseBlock!.brandCategory, "Food Service");
  assert.equal(r.franchiseBlock!.brandMaturityYears, null);
});

test("franchise block: brand disclosed when unit_count >= 50", () => {
  const i = sampleInput({
    franchise: {
      brand_id: "b1",
      brand_name: "BigBrand Franchise",
      brand_category: "Food Service",
      brand_unit_count: 250,
      brand_founding_year: 2000,
    },
  });
  const r = redactForMarketplace(i);
  assert.equal(r.franchiseBlock!.brandName, "BigBrand Franchise");
  assert.ok(r.franchiseBlock!.brandMaturityYears! >= 20);
});

test("franchise placeholder block (brand pending): brand stays null", () => {
  // Round-5 default for Sprint 5 when is_franchise=true but no brand FK.
  const i = sampleInput({
    franchise: {
      brand_id: null,
      brand_name: null,
      brand_category: "Franchise (brand pending)",
      brand_unit_count: null,
      brand_founding_year: null,
    },
  });
  const r = redactForMarketplace(i);
  assert.equal(r.franchiseBlock!.brandName, null);
  assert.equal(r.franchiseBlock!.brandCategory, "Franchise (brand pending)");
});

test("PII leak grep: no precise numbers from input survive serialization", () => {
  const r = redactForMarketplace(sampleInput());
  const serialized = JSON.stringify(r);
  const preciseNumbers = [
    487_250, // loan amount
    123_456, // equity injection
    250_000, // uop equipment amount (should be bucketed away)
    75_000, // uop working capital
    218_000, // liquid_assets
    1_450_000, // net_worth
    735, // FICO
  ];
  for (const n of preciseNumbers) {
    // Use word-boundary match so "75000" doesn't falsely match inside
    // a bucketed "475000". Precise numbers leak if they appear as
    // whole-token digits in the JSON, not as substrings of bucketed
    // values.
    const pattern = new RegExp(`\\b${n}\\b`);
    assert.equal(
      pattern.test(serialized),
      false,
      `precise number ${n} leaked into KFS as whole token: ${serialized.slice(0, 300)}`,
    );
  }
});

test("state is preserved (coarse geography allowed)", () => {
  const r = redactForMarketplace(sampleInput());
  assert.equal(r.state, "WI");
});

test("industry description + NAICS preserved (category-level geography)", () => {
  const r = redactForMarketplace(sampleInput());
  assert.equal(r.industryNaics, "722511");
  assert.equal(r.industryDescription, "Full-service restaurants");
});

test("anonymizedNarrative is empty until Layer 2 fills it", () => {
  const r = redactForMarketplace(sampleInput());
  assert.equal(r.anonymizedNarrative, "");
});

test("risk grade mapping by band", () => {
  const bandToGrade: Array<[string, string]> = [
    ["institutional_prime", "low"],
    ["strong_fit", "low"],
    ["selective_fit", "medium"],
    ["specialty_lender", "high"],
  ];
  for (const [band, expected] of bandToGrade) {
    const i = sampleInput();
    i.score.band = band as any;
    const r = redactForMarketplace(i);
    assert.equal(r.riskGrade, expected);
  }
});
