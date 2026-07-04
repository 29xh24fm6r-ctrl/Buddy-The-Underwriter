/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 4 tests.
 *
 * Covers normal (supported), aggressive, and unsupported add-back cases plus
 * recurring vs nonrecurring EBITDA separation. The load-bearing guarantee:
 * reportedEbitda is never mutated; quality adjustments are opt-in.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { assessEarningsQuality, qualityAdjustedEbitda } from "@/lib/finengine/quality/earningsQuality";
import { evaluateAdjustment, normalizeOwnerComp } from "@/lib/finengine/quality/earningsAdjustments";
import {
  classifyAdjustment,
  classifyAdjustmentCategory,
  isNonRecurring,
} from "@/lib/finengine/quality/recurringIncomeClassifier";

describe("PR4 — adjustment category classification", () => {
  it("PPP/ERC → GOVERNMENT_SUPPORT (nonrecurring)", () => {
    assert.equal(classifyAdjustmentCategory("PPP loan forgiveness"), "GOVERNMENT_SUPPORT");
    assert.equal(classifyAdjustmentCategory("Employee Retention Credit (ERC)"), "GOVERNMENT_SUPPORT");
    assert.ok(isNonRecurring("ERC refund"));
  });
  it("gain on sale → ASSET_SALE (nonrecurring)", () => {
    assert.equal(classifyAdjustmentCategory("Gain on sale of equipment"), "ASSET_SALE");
    assert.ok(isNonRecurring("Gain on sale of equipment"));
  });
  it("insurance proceeds → nonrecurring", () => {
    assert.ok(isNonRecurring("Insurance proceeds from fire loss"));
  });
  it("legal settlement → nonrecurring", () => {
    assert.equal(classifyAdjustmentCategory("Litigation settlement expense"), "LEGAL_SETTLEMENT");
  });
  it("owner comp → OWNER_COMP_NORMALIZATION (recurring standing adjustment)", () => {
    const c = classifyAdjustment("Excess officer compensation");
    assert.equal(c.category, "OWNER_COMP_NORMALIZATION");
    assert.equal(c.recurrence, "RECURRING");
  });
  it("related-party rent → RELATED_PARTY_RENT", () => {
    assert.equal(classifyAdjustmentCategory("Above-market related party rent"), "RELATED_PARTY_RENT");
  });
});

describe("PR4 — adjustment evaluation (supported vs aggressive)", () => {
  it("supported owner-comp add-back is clean", () => {
    const e = evaluateAdjustment(
      { label: "Excess owner compensation", amount: 50_000, direction: "ADD", support: "doc:comp-study" },
      500_000,
    );
    assert.equal(e.supported, true);
    assert.equal(e.aggressive, false);
  });
  it("unsupported add-back is aggressive", () => {
    const e = evaluateAdjustment({ label: "Owner comp addback", amount: 40_000, direction: "ADD" }, 500_000);
    assert.equal(e.supported, false);
    assert.equal(e.aggressive, true);
    assert.ok(e.reasons.includes("unsupported_addback"));
  });
  it("oversized unsupported add-back flags oversized", () => {
    const e = evaluateAdjustment({ label: "Owner comp", amount: 200_000, direction: "ADD" }, 500_000);
    assert.ok(e.reasons.includes("oversized_addback"));
  });
  it("uncategorized add-back is aggressive", () => {
    const e = evaluateAdjustment({ label: "Miscellaneous adjustment", amount: 10_000, direction: "ADD", support: "doc:x" }, 500_000);
    assert.ok(e.reasons.includes("uncategorized_addback"));
    assert.equal(e.aggressive, true);
  });
});

describe("PR4 — recurring vs nonrecurring EBITDA", () => {
  it("strips a nonrecurring gain out of recurring EBITDA", () => {
    const q = assessEarningsQuality({
      reportedEbitda: 1_000_000,
      adjustments: [{ label: "Gain on sale of building", amount: 300_000, direction: "SUBTRACT", support: "doc:closing" }],
    });
    assert.equal(q.reportedEbitda, 1_000_000); // unchanged
    assert.equal(q.recurringEbitda, 700_000); // gain removed
  });

  it("adds back a nonrecurring loss into recurring EBITDA", () => {
    const q = assessEarningsQuality({
      reportedEbitda: 800_000,
      adjustments: [{ label: "One-time litigation settlement", amount: 150_000, direction: "ADD", support: "doc:legal" }],
    });
    assert.equal(q.recurringEbitda, 950_000);
  });
});

describe("PR4 — quality-adjusted EBITDA is opt-in and supported-only", () => {
  it("normal case: supported owner-comp normalization is credited", () => {
    const q = assessEarningsQuality({
      reportedEbitda: 1_000_000,
      adjustments: [{ label: "Excess owner compensation", amount: 120_000, direction: "ADD", support: "doc:comp-study" }],
    });
    assert.equal(q.reportedEbitda, 1_000_000);
    assert.equal(q.qualityAdjustedEbitda, 1_120_000);
    assert.equal(q.confidence, 1);
    assert.deepEqual(q.concerns, []);
  });

  it("aggressive/unsupported add-back is EXCLUDED from quality-adjusted EBITDA", () => {
    const q = assessEarningsQuality({
      reportedEbitda: 1_000_000,
      adjustments: [{ label: "Excess owner compensation", amount: 120_000, direction: "ADD" /* no support */ }],
    });
    // Not credited — quality-adjusted stays at recurring (=reported here).
    assert.equal(q.qualityAdjustedEbitda, 1_000_000);
    assert.ok(q.concerns.some((c) => c.startsWith("aggressive_addback")));
    assert.ok(q.confidence < 1);
  });

  it("reported EBITDA is never mutated regardless of adjustments", () => {
    const input = {
      reportedEbitda: 500_000,
      adjustments: [
        { label: "Gain on sale", amount: 100_000, direction: "SUBTRACT" as const, support: "doc:1" },
        { label: "Owner comp", amount: 60_000, direction: "ADD" as const, support: "doc:2" },
      ],
    };
    const q = assessEarningsQuality(input);
    assert.equal(q.reportedEbitda, 500_000);
    assert.equal(input.reportedEbitda, 500_000);
    // qualityAdjusted convenience matches the field.
    assert.equal(qualityAdjustedEbitda(input), q.qualityAdjustedEbitda);
  });
});

describe("PR4 — owner comp normalization", () => {
  it("excess over market, never negative", () => {
    assert.equal(normalizeOwnerComp({ reportedOwnerComp: 300_000, reasonableMarketComp: 180_000 }).excessAddBack, 120_000);
    assert.equal(normalizeOwnerComp({ reportedOwnerComp: 100_000, reasonableMarketComp: 180_000 }).excessAddBack, 0);
  });
  it("flags missing benchmark", () => {
    assert.equal(normalizeOwnerComp({ reportedOwnerComp: 300_000, reasonableMarketComp: 0 }).concern, "no_market_comp_benchmark_provided");
  });
});
