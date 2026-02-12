/**
 * Memo Engine — Tests
 *
 * Tests recommendation logic, section builders, and full memo generation.
 * Uses node:test + node:assert/strict.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { CreditSnapshot } from "@/lib/creditMetrics/types";
import type { ProductAnalysis } from "@/lib/creditLenses/types";
import type { PolicyResult } from "@/lib/policyEngine/types";
import type { StressResult } from "@/lib/stressEngine/types";
import type { PricingResult } from "@/lib/pricingEngine/types";
import type { MemoInput, MemoSectionKey } from "../types";
import { getRecommendation } from "../recommendation";
import { generateMemo } from "../index";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSnapshot(overrides?: Partial<CreditSnapshot>): CreditSnapshot {
  return {
    dealId: "test-deal",
    period: {
      periodId: "fy-2024",
      periodEnd: "2024-12-31",
      type: "FYE",
      diagnostics: {
        reason: "Latest FYE period selected",
        candidatePeriods: ["fy-2024"],
        excludedPeriods: [],
      },
    },
    debtService: {
      totalDebtService: 40_000,
      breakdown: { proposed: 40_000, existing: undefined },
      diagnostics: { source: "debtEngine" },
    },
    ratios: {
      periodId: "fy-2024",
      metrics: {
        dscr: { value: 2.5, inputs: { ebitda: 100_000, debtService: 40_000 }, formula: "EBITDA / DS" },
        leverageDebtToEbitda: { value: 3.0, inputs: {}, formula: "Debt / EBITDA" },
        currentRatio: { value: 1.8, inputs: {}, formula: "CA / CL" },
        ebitdaMargin: { value: 0.25, inputs: {}, formula: "EBITDA / Revenue" },
        netMargin: { value: 0.15, inputs: {}, formula: "NI / Revenue" },
      },
    },
    generatedAt: "2024-12-31T00:00:00Z",
    ...overrides,
  };
}

function makeAnalysis(): ProductAnalysis {
  return {
    product: "SBA",
    periodId: "fy-2024",
    periodEnd: "2024-12-31",
    keyMetrics: {
      dscr: 2.5,
      leverage: 3.0,
      currentRatio: 1.8,
      ebitdaMargin: 0.25,
      netMargin: 0.15,
    },
    strengths: ["Strong DSCR coverage", "Healthy current ratio"],
    weaknesses: ["Moderate leverage"],
    riskSignals: [],
    dataGaps: [],
    diagnostics: { missingMetrics: [], notes: [] },
  };
}

function makePolicy(tier: "A" | "B" | "C" | "D" = "A"): PolicyResult {
  const breaches = tier === "C" || tier === "D"
    ? [{
        metric: "leverage",
        threshold: { metric: "leverage", maximum: 4.0 },
        actualValue: 5.5,
        severity: "severe" as const,
        deviation: 0.375,
      }]
    : [];

  return {
    product: "SBA",
    passed: tier === "A" || tier === "B",
    failedMetrics: breaches.map((b) => b.metric),
    breaches,
    warnings: [],
    metricsEvaluated: { dscr: 2.5, leverage: 3.0 },
    tier,
  };
}

function makeStress(): StressResult {
  const baselineResult = {
    key: "BASELINE" as const,
    label: "Baseline (No Stress)",
    snapshot: makeSnapshot(),
    policy: makePolicy("A"),
  };

  return {
    baseline: baselineResult,
    scenarios: [
      baselineResult,
      {
        key: "EBITDA_10_DOWN" as const,
        label: "EBITDA -10%",
        snapshot: makeSnapshot(),
        policy: makePolicy("A"),
        dscrDelta: -0.25,
        debtServiceDelta: 0,
      },
    ],
    worstTier: "A",
    tierDegraded: false,
  };
}

function makePricing(): PricingResult {
  return {
    product: "SBA",
    baseRate: 0.1125,
    riskPremiumBps: 0,
    stressAdjustmentBps: 0,
    finalRate: 0.1125,
    rationale: [
      "Base rate: PRIME 8.50% + 275bps spread = 11.25%",
      "Risk premium: Tier A → +0bps",
      "Final rate: 11.25%",
    ],
  };
}

function makeInput(tier: "A" | "B" | "C" | "D" = "A"): MemoInput {
  return {
    dealId: "test-deal",
    product: "SBA",
    snapshot: makeSnapshot(),
    analysis: makeAnalysis(),
    policy: makePolicy(tier),
    stress: makeStress(),
    pricing: makePricing(),
  };
}

// ---------------------------------------------------------------------------
// Recommendation Tests
// ---------------------------------------------------------------------------

describe("Recommendation", () => {
  it("tier A → APPROVE", () => {
    const rec = getRecommendation("A");
    assert.equal(rec.type, "APPROVE");
  });

  it("tier B → APPROVE", () => {
    const rec = getRecommendation("B");
    assert.equal(rec.type, "APPROVE");
  });

  it("tier C → APPROVE_WITH_MITIGANTS", () => {
    const rec = getRecommendation("C");
    assert.equal(rec.type, "APPROVE_WITH_MITIGANTS");
  });

  it("tier D → DECLINE_OR_RESTRUCTURE", () => {
    const rec = getRecommendation("D");
    assert.equal(rec.type, "DECLINE_OR_RESTRUCTURE");
  });
});

// ---------------------------------------------------------------------------
// Section Tests
// ---------------------------------------------------------------------------

const ALL_SECTIONS: MemoSectionKey[] = [
  "executiveSummary",
  "transactionOverview",
  "financialAnalysis",
  "policyAssessment",
  "stressAnalysis",
  "pricingSummary",
  "risksAndMitigants",
  "recommendation",
];

describe("generateMemo", () => {
  it("contains all 8 sections", () => {
    const memo = generateMemo(makeInput());
    for (const key of ALL_SECTIONS) {
      assert.ok(memo.sections[key], `Missing section: ${key}`);
      assert.ok(memo.sections[key].content.length > 0, `Empty content: ${key}`);
    }
  });

  it("executive summary mentions product and tier", () => {
    const memo = generateMemo(makeInput());
    const content = memo.sections.executiveSummary.content;
    assert.ok(content.includes("SBA"), "Should mention product");
    assert.ok(content.includes("tier A"), "Should mention tier");
  });

  it("transaction overview includes deal ID", () => {
    const memo = generateMemo(makeInput());
    assert.ok(memo.sections.transactionOverview.content.includes("test-deal"));
  });

  it("financial analysis lists DSCR metric", () => {
    const memo = generateMemo(makeInput());
    assert.ok(memo.sections.financialAnalysis.content.includes("DSCR"));
  });

  it("policy assessment shows pass for tier A", () => {
    const memo = generateMemo(makeInput("A"));
    assert.ok(memo.sections.policyAssessment.content.includes("thresholds met"));
  });

  it("policy assessment lists breaches for tier C", () => {
    const memo = generateMemo(makeInput("C"));
    assert.ok(memo.sections.policyAssessment.content.includes("leverage"));
    assert.ok(memo.sections.policyAssessment.content.includes("severe"));
  });

  it("recommendation for tier C mentions mitigants", () => {
    const memo = generateMemo(makeInput("C"));
    const content = memo.sections.recommendation.content;
    assert.ok(content.includes("APPROVE WITH MITIGANTS"));
  });

  it("recommendation for tier D mentions decline", () => {
    const memo = generateMemo(makeInput("D"));
    const content = memo.sections.recommendation.content;
    assert.ok(content.includes("DECLINE OR RESTRUCTURE"));
  });

  it("sets recommendation type correctly", () => {
    assert.equal(generateMemo(makeInput("A")).recommendation, "APPROVE");
    assert.equal(generateMemo(makeInput("C")).recommendation, "APPROVE_WITH_MITIGANTS");
    assert.equal(generateMemo(makeInput("D")).recommendation, "DECLINE_OR_RESTRUCTURE");
  });

  it("is deterministic — same inputs produce same sections", () => {
    const m1 = generateMemo(makeInput());
    const m2 = generateMemo(makeInput());
    for (const key of ALL_SECTIONS) {
      assert.equal(m1.sections[key].content, m2.sections[key].content);
    }
  });
});
