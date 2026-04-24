import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

// Route `server-only` to its no-op for test context.
const require = createRequire(import.meta.url);
const Module = require("module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") {
    return path.join(process.cwd(), "node_modules/server-only/empty.js");
  }
  return origResolve.call(this, request, ...args);
};

const { assembleScoreForTesting, SCORE_VERSION } =
  require("../buddySbaScore") as typeof import("../buddySbaScore");
const { evaluateBuddySbaEligibility } =
  require("../eligibility/evaluate") as typeof import("../eligibility/evaluate");

import type { ScoreInputs } from "../inputs";
import type { EligibilityResult } from "../types";

// ─── Fixture factory ───────────────────────────────────────────────────
// Builds a ScoreInputs bundle in-memory — no DB, no buildSBARiskProfile
// roundtrip. Tuning knobs let us drive each component to a target score.

type Tune = {
  // Borrower
  fico?: number | null;
  liquid?: number | null;
  netWorth?: number | null;
  experienceYears?: number | null;
  managementSize?: number | null;
  // Business
  yearsInBusiness?: number | null;
  feasibility?: number | null;
  industryTier?: "low" | "medium" | "high" | "very_high" | "unknown";
  // Structure
  loanAmount?: number | null;
  equityInjection?: number | null;
  totalProjectCost?: number | null;
  collateralLendable?: number | null;
  guaranty?: number | null;
  // Repayment
  dscrBase?: number | null;
  dscrStress?: number | null;
  dscrGlobal?: number | null;
  annualRevenue?: number | null;
  projYear1Revenue?: number | null;
  termTier?: "low" | "medium" | "high" | "very_high" | "unknown";
  // Franchise
  isFranchise?: boolean;
  franchiseCert?: string | null;
  franchiseItem19Percentile?: number | null;
  franchiseUnits?: number | null;
  franchiseSbaEligible?: boolean | null;
  // Eligibility
  naics?: string | null;
  employeeCount?: number | null;
  businessEntityType?: string | null;
  useOfProceeds?: unknown[] | null;
  hardBlockers?: string[];
};

function pick<K extends keyof Tune>(t: Tune, key: K, dflt: Tune[K]): Tune[K] {
  // Explicit null must stay null — only fall back to the default when the
  // key was not provided at all. `??` would coalesce null → default.
  return key in t ? t[key] : dflt;
}

function buildInputs(t: Tune = {}): ScoreInputs {
  const isFranchise = pick(t, "isFranchise", false) as boolean;
  const loanAmount = pick(t, "loanAmount", 500_000) as number | null;
  const equityInjection = pick(t, "equityInjection", 150_000) as number | null;
  const totalProjectCost = pick(t, "totalProjectCost", 650_000) as number | null;
  const annualRevenue = pick(t, "annualRevenue", 2_000_000) as number | null;

  const riskProfile = {
    dealId: "synth-deal",
    computedAt: new Date().toISOString(),
    loanType: "7a",
    industryFactor: {
      factorName: "industry_default_rate",
      label: "synth",
      tier: t.industryTier ?? "low",
      riskScore: 1,
      narrative: "synth",
      source: "synth",
    },
    businessAgeFactor: {
      factorName: "business_age",
      label: "synth",
      tier: "low",
      riskScore: 1,
      narrative: "synth",
      source: "synth",
    },
    loanTermFactor: {
      factorName: "loan_term",
      label: "synth",
      tier: t.termTier ?? "low",
      riskScore: 1,
      narrative: "synth",
      source: "synth",
    },
    urbanRuralFactor: {
      factorName: "urban_rural",
      label: "synth",
      tier: "low",
      riskScore: 1,
      narrative: "synth",
      source: "synth",
    },
    compositeRiskScore: 1,
    compositeRiskTier: "low",
    compositeNarrative: "synth",
    newBusinessResult: {} as any,
    requiresProjectedDscr: false,
    projectedDscrThreshold: 1.25,
    equityInjectionFloor: 0.1,
    hardBlockers: t.hardBlockers ?? [],
    softWarnings: [],
  } as any;

  return {
    dealId: "synth-deal",
    bankId: "synth-bank",
    loanAmount,
    program: "7a",
    isFranchise,
    riskProfile,
    naics: t.naics ?? "722513",
    industry: "Food service",
    businessEntityType: t.businessEntityType ?? "LLC",
    applicants: [
      {
        applicantId: "app-1",
        ficoScore: pick(t, "fico", 740) as number | null,
        liquidAssets: pick(t, "liquid", 300_000) as number | null,
        netWorth: pick(t, "netWorth", 800_000) as number | null,
        industryExperienceYears: pick(t, "experienceYears", 8) as number | null,
      },
    ],
    dscrBase: pick(t, "dscrBase", 1.45) as number | null,
    dscrStress: pick(t, "dscrStress", 1.2) as number | null,
    dscrGlobal: pick(t, "dscrGlobal", 1.35) as number | null,
    sbaGuarantyPct: pick(t, "guaranty", 0.75) as number | null,
    sourcesAndUses: {
      equity_injection: equityInjection,
      total_project_cost: totalProjectCost,
      total_uses: totalProjectCost,
    },
    useOfProceeds: t.useOfProceeds ?? [{ category: "working capital" }],
    projectionsAnnual: t.projYear1Revenue != null
      ? { year1: { revenue: t.projYear1Revenue } }
      : annualRevenue != null
        ? { year1: { revenue: annualRevenue * 1.05 } }
        : null,
    collateralNetLendableTotal: t.collateralLendable ?? 400_000,
    equityInjectionAmount: equityInjection,
    totalProjectCost,
    feasibilityComposite: pick(t, "feasibility", 80) as number | null,
    feasibilityDimensions: {
      marketDemand: 80,
      financialViability: 80,
      operationalReadiness: 80,
      locationSuitability: 80,
    },
    yearsInBusiness: pick(t, "yearsInBusiness", 6) as number | null,
    annualRevenueUsd: annualRevenue,
    employeeCount: pick(t, "employeeCount", 20) as number | null,
    franchise: isFranchise
      ? {
          brandId: "brand-1",
          unitCount: pick(t, "franchiseUnits", 250) as number | null,
          foundingYear: 2010,
          sbaEligible: pick(t, "franchiseSbaEligible", true) as boolean | null,
          sbaCertificationStatus: pick(t, "franchiseCert", "certified") as string | null,
          hasItem19: true,
          item19PercentileRank: pick(t, "franchiseItem19Percentile", 70) as number | null,
        }
      : null,
    managementTeamSize: pick(t, "managementSize", 3) as number | null,
    snapshot: { synth: true },
    missingInputs: [],
  };
}

function evalFromInputs(inputs: ScoreInputs): EligibilityResult {
  return evaluateBuddySbaEligibility({
    naics: inputs.naics,
    industry: inputs.industry,
    businessEntityType: inputs.businessEntityType,
    annualRevenueUsd: inputs.annualRevenueUsd,
    employeeCount: inputs.employeeCount,
    useOfProceeds: inputs.useOfProceeds,
    sourcesAndUses: inputs.sourcesAndUses,
    isFranchise: inputs.isFranchise,
    franchiseSbaEligible: inputs.franchise?.sbaEligible ?? null,
    franchiseSbaCertificationStatus: inputs.franchise?.sbaCertificationStatus ?? null,
    hardBlockers: inputs.riskProfile.hardBlockers,
  });
}

// ─── Smoke tests ───────────────────────────────────────────────────────

test("synthetic: SCORE_VERSION exported as 1.0.0", () => {
  assert.equal(SCORE_VERSION, "1.0.0");
});

test("synthetic: strong deal (max-ish everything) lands in institutional_prime", () => {
  const inputs = buildInputs({
    fico: 800,
    liquid: 500_000,
    netWorth: 2_000_000,
    experienceYears: 15,
    managementSize: 5,
    yearsInBusiness: 15,
    feasibility: 92,
    industryTier: "low",
    loanAmount: 500_000,
    equityInjection: 200_000, // 30.8% of project
    totalProjectCost: 650_000,
    collateralLendable: 600_000,
    guaranty: 0.85,
    dscrBase: 1.8,
    dscrStress: 1.4,
    dscrGlobal: 1.6,
    annualRevenue: 2_000_000,
    projYear1Revenue: 2_100_000, // 5% variance
    termTier: "low",
  });
  const eligibility = evalFromInputs(inputs);
  const score = assembleScoreForTesting({ inputs, eligibility });
  assert.equal(score.eligibilityPassed, true, JSON.stringify(eligibility.failures));
  assert.ok(score.score >= 90, `expected institutional_prime, got ${score.score}`);
  assert.equal(score.band, "institutional_prime");
  assert.equal(score.rateCardTier, "best");
});

test("synthetic: weak but eligible deal lands in specialty_lender (60–69)", () => {
  const inputs = buildInputs({
    fico: 650, // 2/5
    liquid: 40_000, // vs 150k injection → 0.27 → 1/5
    netWorth: 60_000, // 0.12 of loan → 2/5
    experienceYears: 1, // 2/5
    managementSize: 1, // 2/5
    yearsInBusiness: 2, // 2/5
    feasibility: 55, // 2/5
    industryTier: "high", // 2/5
    equityInjection: 60_000, // 60k / 650k = 9.2% → 2/5
    collateralLendable: 150_000, // 0.3 → 2/5
    guaranty: 0.5, // 3/5
    dscrBase: 1.2, // 2/5
    dscrStress: 1.05, // 3/5
    dscrGlobal: 1.1, // 2/5
    projYear1Revenue: 2_500_000, // 25% variance → 3/5
    termTier: "high", // 2/5
  });
  const eligibility = evalFromInputs(inputs);
  const score = assembleScoreForTesting({ inputs, eligibility });
  assert.equal(score.eligibilityPassed, true, JSON.stringify(eligibility.failures));
  assert.ok(score.score >= 40 && score.score < 70,
    `expected 40-69 specialty-ish territory, got ${score.score}`);
});

test("synthetic: eligibility-failing deal returns score 0 / band not_eligible", () => {
  const inputs = buildInputs({ businessEntityType: "NONPROFIT" });
  const eligibility = evalFromInputs(inputs);
  assert.equal(eligibility.passed, false);
  const score = assembleScoreForTesting({ inputs, eligibility });
  assert.equal(score.score, 0);
  assert.equal(score.band, "not_eligible");
  assert.equal(score.rateCardTier, null);
  assert.equal(score.eligibilityPassed, false);
  assert.ok(score.eligibilityFailures.length > 0);
  assert.ok(score.narrative.includes("Not marketplace-eligible"));
});

test("synthetic: franchise deal includes franchiseQuality with 10% weight", () => {
  const inputs = buildInputs({ isFranchise: true });
  const eligibility = evalFromInputs(inputs);
  const score = assembleScoreForTesting({ inputs, eligibility });
  assert.ok(score.franchiseQuality);
  assert.equal(score.franchiseQuality!.weight, 0.1);
  // When franchise present, borrower weight is 0.25 (vs 0.28 otherwise).
  assert.equal(score.borrowerStrength.weight, 0.25);
});

test("synthetic: non-franchise redistributes weights across 4 components", () => {
  const inputs = buildInputs({ isFranchise: false });
  const eligibility = evalFromInputs(inputs);
  const score = assembleScoreForTesting({ inputs, eligibility });
  assert.equal(score.franchiseQuality, null);
  // Redistributed weights (per spec §target-shape).
  assert.equal(score.borrowerStrength.weight, 0.28);
  assert.equal(score.businessStrength.weight, 0.22);
  assert.equal(score.dealStructure.weight, 0.17);
  assert.equal(score.repaymentCapacity.weight, 0.33);
  const total =
    score.borrowerStrength.weight +
    score.businessStrength.weight +
    score.dealStructure.weight +
    score.repaymentCapacity.weight;
  assert.ok(Math.abs(total - 1.0) < 0.01, `weights must sum to 1.0, got ${total}`);
});

test("synthetic: missing inputs → components mark insufficientData when >50% weight missing", () => {
  const inputs = buildInputs({
    fico: null,
    liquid: null,
    netWorth: null,
    experienceYears: null,
    managementSize: null,
  });
  const eligibility = evalFromInputs(inputs);
  const score = assembleScoreForTesting({ inputs, eligibility });
  assert.equal(score.borrowerStrength.insufficientData, true);
  assert.ok(score.borrowerStrength.missingInputs.length >= 3);
});

test("synthetic: narrative contains no LLM-style generated prose (marker strings only)", () => {
  const inputs = buildInputs();
  const eligibility = evalFromInputs(inputs);
  const score = assembleScoreForTesting({ inputs, eligibility });
  // Narrative is templated — must include deterministic framing.
  assert.ok(score.narrative.startsWith("Buddy SBA Score:"));
  assert.match(score.narrative, /Component breakdown:/);
  // Anti-LLM markers — anything resembling free-form prose we wouldn't
  // generate deterministically.
  assert.ok(!score.narrative.toLowerCase().includes("i think"));
  assert.ok(!score.narrative.toLowerCase().includes("i believe"));
});

test("synthetic: each band boundary produces correct band string", () => {
  const tuningsByBand: Array<{
    name: string;
    expectedBand: import("../types").ScoreBand;
    expectedTier: import("../types").RateCardTier | null;
    tune: Tune;
  }> = [
    {
      name: "institutional_prime",
      expectedBand: "institutional_prime",
      expectedTier: "best",
      tune: {
        fico: 800, liquid: 500_000, netWorth: 2_000_000, experienceYears: 15,
        managementSize: 5, yearsInBusiness: 15, feasibility: 92,
        industryTier: "low", equityInjection: 200_000, collateralLendable: 600_000,
        guaranty: 0.85, dscrBase: 1.8, dscrStress: 1.4, dscrGlobal: 1.6,
        projYear1Revenue: 2_100_000, termTier: "low",
      },
    },
    {
      name: "not_eligible via ineligibility",
      expectedBand: "not_eligible",
      expectedTier: null,
      tune: { businessEntityType: "NONPROFIT" },
    },
  ];

  for (const tb of tuningsByBand) {
    const inputs = buildInputs(tb.tune);
    const eligibility = evalFromInputs(inputs);
    const score = assembleScoreForTesting({ inputs, eligibility });
    assert.equal(score.band, tb.expectedBand, `${tb.name}: band mismatch (score ${score.score})`);
    assert.equal(score.rateCardTier, tb.expectedTier, `${tb.name}: tier mismatch`);
  }
});

test("synthetic: score is always an integer 0-100 bounded by clamp", () => {
  const inputs = buildInputs();
  const eligibility = evalFromInputs(inputs);
  const score = assembleScoreForTesting({ inputs, eligibility });
  assert.equal(Number.isInteger(score.score), true);
  assert.ok(score.score >= 0 && score.score <= 100);
});
