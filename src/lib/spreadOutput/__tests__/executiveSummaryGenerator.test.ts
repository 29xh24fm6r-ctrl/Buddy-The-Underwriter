import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateExecutiveSummary } from "../executiveSummaryGenerator";
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

describe("executiveSummaryGenerator", () => {
  // ── Recommendation level ────────────────────────────────────────────────
  it("returns strong recommendation for DSCR >= 1.50 with no critical flags", () => {
    const input = makeInput({ ratios: { DSCR: 1.60 } });
    const narratives = composeNarratives(input);
    const summary = generateExecutiveSummary(input, narratives);
    assert.equal(summary.recommendation_level, "strong");
  });

  it("returns adequate recommendation for DSCR 1.25-1.50", () => {
    const input = makeInput({ ratios: { DSCR: 1.35 } });
    const narratives = composeNarratives(input);
    const summary = generateExecutiveSummary(input, narratives);
    assert.equal(summary.recommendation_level, "adequate");
  });

  it("returns marginal recommendation for DSCR 1.10-1.25", () => {
    const input = makeInput({ ratios: { DSCR: 1.15 } });
    const narratives = composeNarratives(input);
    const summary = generateExecutiveSummary(input, narratives);
    assert.equal(summary.recommendation_level, "marginal");
  });

  it("returns insufficient recommendation for DSCR < 1.10", () => {
    const input = makeInput({ ratios: { DSCR: 0.90 } });
    const narratives = composeNarratives(input);
    const summary = generateExecutiveSummary(input, narratives);
    assert.equal(summary.recommendation_level, "insufficient");
  });

  it("downgrades to insufficient when critical flags exist regardless of DSCR", () => {
    const input = makeInput({
      ratios: { DSCR: 1.60 },
      flag_report: {
        deal_id: "deal-1",
        flags: [{
          flag_id: "f1", deal_id: "deal-1", category: "policy_proximity", severity: "critical",
          trigger_type: "dscr_below_1x", canonical_keys_involved: ["DSCR"],
          observed_value: 0.9, banker_summary: "Critical", banker_detail: "",
          banker_implication: "", status: "open", auto_generated: true,
          borrower_question: null, year_observed: 2023,
          created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
        }],
        critical_count: 1,
        elevated_count: 0,
        watch_count: 0,
        informational_count: 0,
        has_blocking_flags: true,
      },
    });
    const narratives = composeNarratives(input);
    const summary = generateExecutiveSummary(input, narratives);
    assert.equal(summary.recommendation_level, "insufficient");
  });

  // ── Summary fields ──────────────────────────────────────────────────────
  it("business_overview is a non-empty string", () => {
    const input = makeInput({ ratios: { DSCR: 1.35 } });
    const narratives = composeNarratives(input);
    const summary = generateExecutiveSummary(input, narratives);
    assert.ok(summary.business_overview.length > 0);
  });

  it("business_overview includes revenue when available", () => {
    const input = makeInput({
      canonical_facts: { TOTAL_REVENUE: 2_500_000 },
      ratios: { DSCR: 1.35 },
    });
    const narratives = composeNarratives(input);
    const summary = generateExecutiveSummary(input, narratives);
    assert.ok(summary.business_overview.includes("$2.5M"), `Expected revenue in overview: ${summary.business_overview}`);
  });

  it("coverage_summary contains DSCR narrative when available", () => {
    const input = makeInput({ ratios: { DSCR: 1.45 } });
    const narratives = composeNarratives(input);
    const summary = generateExecutiveSummary(input, narratives);
    assert.ok(summary.coverage_summary.includes("adequate") || summary.coverage_summary.includes("coverage"),
      `Expected coverage content: ${summary.coverage_summary}`);
  });

  it("recommendation_language is a non-empty string", () => {
    const input = makeInput({ ratios: { DSCR: 1.35 } });
    const narratives = composeNarratives(input);
    const summary = generateExecutiveSummary(input, narratives);
    assert.ok(summary.recommendation_language.length > 0);
  });

  it("risk_flags_summary indicates no flags when none exist", () => {
    const input = makeInput({ ratios: { DSCR: 1.35 } });
    const narratives = composeNarratives(input);
    const summary = generateExecutiveSummary(input, narratives);
    assert.ok(
      summary.risk_flags_summary.includes("No") ||
      summary.risk_flags_summary.includes("no") ||
      summary.risk_flags_summary.length === 0,
    );
  });

  it("no placeholders in any summary field", () => {
    const input = makeInput({
      ratios: { DSCR: 1.15 },
      canonical_facts: { TOTAL_REVENUE: 1_000_000 },
    });
    const narratives = composeNarratives(input);
    const summary = generateExecutiveSummary(input, narratives);
    const fields = [
      summary.business_overview,
      summary.financial_snapshot,
      summary.coverage_summary,
      summary.collateral_summary,
      summary.risk_flags_summary,
      summary.recommendation_language,
    ];
    for (const field of fields) {
      assert.ok(!/\{[a-z_]+\}/.test(field), `Placeholder found: ${field}`);
    }
  });
});
