import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRatioScorecard, formatRatioValue } from "../ratioScorecardBuilder";
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

describe("ratioScorecardBuilder", () => {
  // ── Basic structure ─────────────────────────────────────────────────────
  it("returns groups matching template ratio groups", () => {
    const input = makeInput({ ratios: { DSCR: 1.35 } });
    const narratives = composeNarratives(input);
    const scorecard = buildRatioScorecard(input, narratives);
    assert.ok(scorecard.groups.length > 0);
    assert.ok(scorecard.groups[0].group_name.length > 0);
  });

  it("returns overall assessment as string", () => {
    const input = makeInput({ ratios: { DSCR: 1.80 } });
    const narratives = composeNarratives(input);
    const scorecard = buildRatioScorecard(input, narratives);
    assert.ok(["strong", "adequate", "marginal", "insufficient"].includes(scorecard.overall_assessment));
  });

  // ── Ratio values ────────────────────────────────────────────────────────
  it("picks up DSCR from ratios", () => {
    const input = makeInput({ ratios: { DSCR: 1.45 } });
    const narratives = composeNarratives(input);
    const scorecard = buildRatioScorecard(input, narratives);
    const dscrItem = findRatio(scorecard, "DSCR");
    assert.ok(dscrItem, "DSCR item should exist");
    assert.equal(dscrItem!.value, 1.45);
  });

  it("resolves alias ratio_dscr_final to DSCR", () => {
    const input = makeInput({ ratios: { ratio_dscr_final: 1.30 } });
    const narratives = composeNarratives(input);
    const scorecard = buildRatioScorecard(input, narratives);
    const dscrItem = findRatio(scorecard, "DSCR");
    assert.ok(dscrItem, "DSCR item should exist via alias");
    assert.equal(dscrItem!.value, 1.30);
  });

  it("handles missing ratio gracefully", () => {
    const input = makeInput({ ratios: {} });
    const narratives = composeNarratives(input);
    const scorecard = buildRatioScorecard(input, narratives);
    const dscrItem = findRatio(scorecard, "DSCR");
    // Item may exist with null value
    if (dscrItem) {
      assert.equal(dscrItem.value, null);
    }
  });

  // ── Policy evaluation ──────────────────────────────────────────────────
  it("marks DSCR as passing when above policy minimum", () => {
    const input = makeInput({ ratios: { DSCR: 1.50 } });
    const narratives = composeNarratives(input);
    const scorecard = buildRatioScorecard(input, narratives);
    const dscrItem = findRatio(scorecard, "DSCR");
    assert.ok(dscrItem);
    assert.equal(dscrItem!.passes_policy, true);
  });

  it("marks DSCR as failing when below policy minimum", () => {
    const input = makeInput({ ratios: { DSCR: 1.10 } });
    const narratives = composeNarratives(input);
    const scorecard = buildRatioScorecard(input, narratives);
    const dscrItem = findRatio(scorecard, "DSCR");
    assert.ok(dscrItem);
    assert.equal(dscrItem!.passes_policy, false);
  });

  it("respects custom bank policy overrides", () => {
    const input = makeInput({
      ratios: { DSCR: 1.20 },
      bank_policy: {
        dscr_minimum: 1.15,
        fccr_minimum: 1.10,
        current_ratio_minimum: 1.00,
        ltv_maximum: 0.80,
        ltc_maximum: 0.85,
        debt_ebitda_maximum: 5.0,
        post_close_liquidity_pct: 0.05,
      },
    });
    const narratives = composeNarratives(input);
    const scorecard = buildRatioScorecard(input, narratives);
    const dscrItem = findRatio(scorecard, "DSCR");
    assert.ok(dscrItem);
    assert.equal(dscrItem!.passes_policy, true);
  });

  // ── Assessment mapping ──────────────────────────────────────────────────
  it("assigns strong assessment for very high DSCR with NAICS context", () => {
    const input = makeInput({
      ratios: { DSCR: 3.5 },
      canonical_facts: { naics_code: "541110", TOTAL_REVENUE: 5_000_000 },
    });
    const narratives = composeNarratives(input);
    const scorecard = buildRatioScorecard(input, narratives);
    const dscrItem = findRatio(scorecard, "DSCR");
    assert.ok(dscrItem);
    assert.equal(dscrItem!.assessment, "strong");
  });

  it("falls back to adequate when no NAICS benchmark and passes policy", () => {
    const input = makeInput({ ratios: { DSCR: 2.0 } });
    const narratives = composeNarratives(input);
    const scorecard = buildRatioScorecard(input, narratives);
    const dscrItem = findRatio(scorecard, "DSCR");
    assert.ok(dscrItem);
    assert.equal(dscrItem!.assessment, "adequate");
  });

  it("assigns concerning assessment for very low DSCR", () => {
    const input = makeInput({ ratios: { DSCR: 0.85 } });
    const narratives = composeNarratives(input);
    const scorecard = buildRatioScorecard(input, narratives);
    const dscrItem = findRatio(scorecard, "DSCR");
    assert.ok(dscrItem);
    assert.equal(dscrItem!.assessment, "concerning");
  });

  // ── Overall assessment ──────────────────────────────────────────────────
  it("overall assessment is strong when all ratios are strong (with NAICS)", () => {
    const input = makeInput({
      ratios: { DSCR: 3.5, CURRENT_RATIO: 5.0 },
      canonical_facts: { naics_code: "541110", TOTAL_REVENUE: 5_000_000 },
    });
    const narratives = composeNarratives(input);
    const scorecard = buildRatioScorecard(input, narratives);
    assert.equal(scorecard.overall_assessment, "strong");
  });

  it("overall assessment downgrades to lowest ratio", () => {
    const input = makeInput({
      ratios: { DSCR: 0.85, CURRENT_RATIO: 3.0 },
    });
    const narratives = composeNarratives(input);
    const scorecard = buildRatioScorecard(input, narratives);
    assert.equal(scorecard.overall_assessment, "insufficient");
  });
});

describe("formatRatioValue", () => {
  it("formats DSCR with x suffix", () => {
    assert.equal(formatRatioValue("DSCR", 1.35), "1.35x");
  });

  it("formats DSO as days", () => {
    assert.equal(formatRatioValue("DSO", 72), "72 days");
  });

  it("formats GROSS_MARGIN as percentage", () => {
    assert.equal(formatRatioValue("GROSS_MARGIN", 0.423), "42.3%");
  });

  it("formats DEBT_TO_EQUITY with x suffix", () => {
    assert.equal(formatRatioValue("DEBT_TO_EQUITY", 2.1), "2.10x");
  });

  it("formats LTV as percentage", () => {
    assert.equal(formatRatioValue("LTV", 0.72), "72.0%");
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findRatio(scorecard: ReturnType<typeof buildRatioScorecard>, key: string) {
  for (const group of scorecard.groups) {
    const item = group.ratios.find((r) => r.canonical_key === key);
    if (item) return item;
  }
  return undefined;
}
