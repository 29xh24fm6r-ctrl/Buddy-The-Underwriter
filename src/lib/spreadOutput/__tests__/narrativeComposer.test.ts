import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeNarratives } from "../narrativeComposer";
import type { SpreadOutputInput } from "../types";

function makeInput(overrides: Partial<SpreadOutputInput> = {}): SpreadOutputInput {
  return {
    deal_id: "deal-1",
    deal_type: "c_and_i",
    canonical_facts: {},
    ratios: {},
    years_available: [2023],
    ...overrides,
  };
}

describe("narrativeComposer", () => {
  // ── Placeholder safety ──────────────────────────────────────────────────
  it("NEVER outputs {curly_brace} placeholders in ratio narratives", () => {
    const result = composeNarratives(makeInput({
      ratios: { DSCR: 1.35 },
    }));
    for (const [_key, narrative] of Object.entries(result.ratio_narratives)) {
      assert.ok(!/\{[a-z_]+\}/.test(narrative), `Placeholder found in: ${narrative}`);
    }
  });

  it("NEVER outputs {curly_brace} placeholders in final narrative", () => {
    const result = composeNarratives(makeInput({
      ratios: { DSCR: 0.85 },
      canonical_facts: { TOTAL_REVENUE: 1_000_000 },
    }));
    assert.ok(!/\{[a-z_]+\}/.test(result.final_narrative), `Placeholder found in final: ${result.final_narrative}`);
  });

  it("NEVER outputs {curly_brace} placeholders in resolution narrative", () => {
    const result = composeNarratives(makeInput({
      ratios: { DSCR: 1.10, global_dscr: 1.35 },
    }));
    assert.ok(!/\{[a-z_]+\}/.test(result.resolution_narrative), `Placeholder found in resolution: ${result.resolution_narrative}`);
  });

  it("NEVER outputs {curly_brace} placeholders in top risks", () => {
    const result = composeNarratives(makeInput({
      ratios: { DSCR: 0.85, DEBT_TO_EBITDA: 6.0 },
    }));
    for (const risk of result.top_risks) {
      assert.ok(!/\{[a-z_]+\}/.test(risk.narrative), `Placeholder in risk: ${risk.narrative}`);
      assert.ok(!/\{[a-z_]+\}/.test(risk.title), `Placeholder in risk title: ${risk.title}`);
    }
  });

  it("NEVER outputs {curly_brace} placeholders in top strengths", () => {
    const result = composeNarratives(makeInput({
      ratios: { DSCR: 1.80, CURRENT_RATIO: 2.5 },
      years_available: [2021, 2022, 2023],
    }));
    for (const s of result.top_strengths) {
      assert.ok(!/\{[a-z_]+\}/.test(s.narrative), `Placeholder in strength: ${s.narrative}`);
    }
  });

  // ── DSCR narrative tiers ────────────────────────────────────────────────
  it("generates strong DSCR narrative for >= 1.50", () => {
    const result = composeNarratives(makeInput({
      ratios: { DSCR: 1.60 },
    }));
    assert.ok(result.ratio_narratives["DSCR"]?.includes("1.60"));
  });

  it("generates adequate DSCR narrative for 1.25-1.50", () => {
    const result = composeNarratives(makeInput({
      ratios: { DSCR: 1.35 },
    }));
    assert.ok(result.ratio_narratives["DSCR"]?.includes("adequate"));
  });

  it("generates marginal DSCR narrative for 1.10-1.25", () => {
    const result = composeNarratives(makeInput({
      ratios: { DSCR: 1.15 },
    }));
    assert.ok(result.ratio_narratives["DSCR"]?.includes("1.15"));
  });

  it("generates insufficient DSCR narrative for < 1.10", () => {
    const result = composeNarratives(makeInput({
      ratios: { DSCR: 0.90 },
    }));
    assert.ok(result.ratio_narratives["DSCR"]?.includes("0.90"));
  });

  // ── Leverage narratives ─────────────────────────────────────────────────
  it("generates leverage narrative when Debt/EBITDA exceeds policy", () => {
    const result = composeNarratives(makeInput({
      ratios: { DEBT_TO_EBITDA: 5.5 },
    }));
    assert.ok(result.ratio_narratives["DEBT_TO_EBITDA"]?.includes("5.50"));
  });

  it("does not generate leverage narrative within policy", () => {
    const result = composeNarratives(makeInput({
      ratios: { DEBT_TO_EBITDA: 3.0 },
    }));
    assert.equal(result.ratio_narratives["DEBT_TO_EBITDA"], undefined);
  });

  // ── DSO narratives ──────────────────────────────────────────────────────
  it("generates DSO narrative when > 60 days", () => {
    const result = composeNarratives(makeInput({
      ratios: { DSO: 75 },
    }));
    assert.ok(result.ratio_narratives["DSO"]?.includes("75"));
  });

  it("does not generate DSO narrative when <= 60", () => {
    const result = composeNarratives(makeInput({
      ratios: { DSO: 45 },
    }));
    assert.equal(result.ratio_narratives["DSO"], undefined);
  });

  // ── Top risks ───────────────────────────────────────────────────────────
  it("includes weak DSCR in top risks", () => {
    const result = composeNarratives(makeInput({
      ratios: { DSCR: 1.10 },
    }));
    assert.ok(result.top_risks.some((r) => r.title.includes("DSCR")));
  });

  it("limits risks to 3", () => {
    const result = composeNarratives(makeInput({
      ratios: { DSCR: 0.85, DEBT_TO_EBITDA: 6.0, DSO: 90 },
      canonical_facts: { TOTAL_REVENUE: 1_000_000 },
      trend_report: {
        trendRevenue: { direction: "DECLINING" as any, values: [1_200_000, 1_000_000], riskSignal: null },
        trendEbitda: { direction: null, values: [], riskSignal: null },
        trendGrossMargin: { direction: null, values: [], riskSignal: null },
        trendDso: { direction: null, values: [], riskSignal: null },
        trendDio: { direction: null, values: [], riskSignal: null },
        trendLeverage: { direction: null, values: [], riskSignal: null },
        trendDscr: { direction: null, values: [], riskSignal: null },
        trendNetWorth: { direction: null, values: [], riskSignal: null },
      },
    }));
    assert.ok(result.top_risks.length <= 3);
  });

  // ── Top strengths ───────────────────────────────────────────────────────
  it("includes strong DSCR in strengths", () => {
    const result = composeNarratives(makeInput({
      ratios: { DSCR: 1.80 },
    }));
    assert.ok(result.top_strengths.some((s) => s.title.includes("Strong debt service")));
  });

  it("includes strong liquidity in strengths", () => {
    const result = composeNarratives(makeInput({
      ratios: { CURRENT_RATIO: 2.5 },
    }));
    assert.ok(result.top_strengths.some((s) => s.title.includes("liquidity")));
  });

  it("includes established history when 3+ years", () => {
    const result = composeNarratives(makeInput({
      years_available: [2021, 2022, 2023],
    }));
    assert.ok(result.top_strengths.some((s) => s.title.includes("Established")));
  });

  it("limits strengths to 3", () => {
    const result = composeNarratives(makeInput({
      ratios: { DSCR: 1.80, CURRENT_RATIO: 3.0 },
      years_available: [2020, 2021, 2022, 2023],
      qoe_report: { reportedEbitda: 500_000, adjustedEbitda: 500_000, adjustmentTotal: 0, adjustments: [], confidence: "high" as const },
    }));
    assert.ok(result.top_strengths.length <= 3);
  });

  // ── Resolution narrative ────────────────────────────────────────────────
  it("generates resolution when global DSCR resolves standalone shortfall", () => {
    const result = composeNarratives(makeInput({
      ratios: { DSCR: 1.10, global_dscr: 1.40 },
    }));
    assert.ok(result.resolution_narrative.length > 0);
  });

  it("returns empty resolution when standalone meets policy", () => {
    const result = composeNarratives(makeInput({
      ratios: { DSCR: 1.35 },
    }));
    assert.equal(result.resolution_narrative, "");
  });

  // ── Final narrative ─────────────────────────────────────────────────────
  it("builds final narrative with revenue when available", () => {
    const result = composeNarratives(makeInput({
      ratios: { DSCR: 1.35 },
      canonical_facts: { TOTAL_REVENUE: 2_500_000 },
    }));
    assert.ok(result.final_narrative.includes("$2.5M"));
  });

  it("builds final narrative without revenue gracefully", () => {
    const result = composeNarratives(makeInput({
      ratios: { DSCR: 1.35 },
    }));
    assert.ok(result.final_narrative.length > 0);
    assert.ok(!/\{[a-z_]+\}/.test(result.final_narrative));
  });

  it("returns empty ratioNarratives when no ratios provided", () => {
    const result = composeNarratives(makeInput());
    assert.equal(Object.keys(result.ratio_narratives).length, 0);
  });

  // ── QoE narratives ─────────────────────────────────────────────────────
  it("generates material QoE narrative for >5% adjustment", () => {
    const result = composeNarratives(makeInput({
      qoe_report: {
        reportedEbitda: 500_000,
        adjustedEbitda: 425_000,
        adjustmentTotal: -75_000,
        adjustments: [],
        confidence: "high" as const,
      },
    }));
    assert.ok(result.ratio_narratives["QOE"]?.includes("$500"));
  });

  it("generates clean QoE narrative for <=5% adjustment", () => {
    const result = composeNarratives(makeInput({
      qoe_report: {
        reportedEbitda: 500_000,
        adjustedEbitda: 490_000,
        adjustmentTotal: -10_000,
        adjustments: [],
        confidence: "high" as const,
      },
    }));
    assert.ok(result.ratio_narratives["QOE"]?.length > 0);
  });
});
