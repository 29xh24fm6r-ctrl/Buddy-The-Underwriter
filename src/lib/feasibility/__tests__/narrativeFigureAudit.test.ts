import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const { auditNarrativeFigures, extractNarrativeFigures, collectEvidenceValues } =
  require("../narrativeFigureAudit") as typeof import("../narrativeFigureAudit");

/**
 * The deterministic evidence the generator was given for deal d4b7104f
 * (buddy_sba_packages 5e8bb939), transcribed from production.
 */
const EVIDENCE = {
  projectionPackage: {
    breakEven: {
      breakEvenRevenue: 1_772_778,
      projectedRevenueYear1: 2_753_880,
      marginOfSafetyPct: 0.356,
      fixedCostsAnnual: 797_750,
      contributionMarginPct: 0.45,
    },
    annualProjections: [
      { year: 1, revenue: 2_753_880, dscr: 1.71 },
      { year: 2, revenue: 2_991_000, dscr: 1.92 },
      { year: 3, revenue: 3_150_000, dscr: 2.19 },
    ],
    sourcesAndUses: { totalUses: 1_000_000, totalSources: 1_000_000 },
  },
  deterministicStudy: {
    financialViability: {
      components: {
        breakEvenMargin: {
          detail: "Margin of safety: 35.6%. Projected revenue exceeds break-even by $981,102.",
        },
      },
    },
  },
};

test("figures the deterministic model produced are traceable", () => {
  const result = auditNarrativeFigures({
    narratives: {
      financialViabilityNarrative:
        "Break-even revenue is approximately $1.77 million versus projected Year 1 revenue " +
        "of approximately $2.75 million. The resulting margin of safety is 35.6%, or " +
        "approximately $981,102 of projected revenue above break-even. Base-case DSCR is " +
        "1.71x, 1.92x, and 2.19x.",
    },
    evidence: EVIDENCE,
  });

  assert.deepEqual(result.untraced, []);
  assert.ok(result.audited > 0);
});

test("the debt-inclusive break-even the reviewer caught is reported as untraceable", () => {
  // Verbatim from the production failure on bundle 2553c660: "These figures
  // are not present in the supplied evidence and appear to be independently
  // computed by the author." The model computes an operating-only break-even;
  // it does not compute a debt-service-inclusive one.
  const result = auditNarrativeFigures({
    narratives: {
      financialViabilityNarrative:
        "Adding debt service implies a debt-inclusive break-even near $2,345,297, leaving a " +
        "residual cushion of $408,583, or 14.8% of revenue.",
    },
    evidence: EVIDENCE,
  });

  const reported = result.untraced.map((f) => f.value).sort((a, b) => a - b);
  assert.deepEqual(reported, [14.8, 408_583, 2_345_297]);
  for (const figure of result.untraced) {
    assert.equal(figure.section, "financialViabilityNarrative");
  }
});

test("rounding a supplied figure is not fabricating one", () => {
  const result = auditNarrativeFigures({
    narratives: { s: "Revenue of $2.75 million against break-even of $1,772,778." },
    evidence: { revenue: 2_753_880, breakEven: 1_772_778.42 },
  });

  assert.deepEqual(result.untraced, []);
});

test("a stored ratio supports the percentage a narrative writes", () => {
  const result = auditNarrativeFigures({
    narratives: { s: "The margin of safety is 35.6% and the contribution margin is 45%." },
    evidence: { marginOfSafetyPct: 0.356, contributionMarginPct: 0.45 },
  });

  assert.deepEqual(result.untraced, []);
});

test("figures reachable only inside an evidence string still count as supplied", () => {
  // Most dimension figures reach the generator inside a `detail` sentence
  // rather than as a JSON number.
  const result = auditNarrativeFigures({
    narratives: { s: "Projected revenue exceeds break-even by $981,102." },
    evidence: {
      components: {
        breakEvenMargin: { detail: "Projected revenue exceeds break-even by $981,102." },
      },
    },
  });

  assert.deepEqual(result.untraced, []);
});

test("small bare amounts read as prose, not as model output", () => {
  const result = auditNarrativeFigures({
    narratives: { s: "The plan adds 12 staff and a $500 monthly software line." },
    evidence: {},
  });

  assert.deepEqual(result.untraced, []);
});

test("extraction understands the shapes a narrative actually writes", () => {
  const figures = extractNarrativeFigures(
    "$1,772,778, $2.75 million, $850K, 35.6%, 1.71x",
  );

  assert.deepEqual(
    figures.map((f) => f.value),
    [1_772_778, 2_750_000, 850_000, 35.6, 1.71],
  );
});

test("evidence collection reaches nested arrays and objects without looping forever", () => {
  const cyclic: Record<string, unknown> = { a: [{ b: 1_234_567 }] };
  cyclic.self = cyclic;

  const values = collectEvidenceValues(cyclic);

  assert.ok(values.includes(1_234_567));
});
