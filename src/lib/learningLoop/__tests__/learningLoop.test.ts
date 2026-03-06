import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateAgainstCorpus } from "../../corpus/corpusValidator";
import { GOLDEN_CORPUS } from "../../corpus/goldenDocuments";
import { analyzePatterns } from "../patternAnalyzer";
import type { CorrectionEvent } from "../types";

function makeCorrectionEvent(
  overrides: Partial<CorrectionEvent> = {}
): CorrectionEvent {
  return {
    id: "test-id",
    dealId: "deal-1",
    documentId: "doc-1",
    documentType: "FORM_1065",
    taxYear: 2024,
    naicsCode: "487210",
    factKey: "GROSS_RECEIPTS",
    originalValue: 100000,
    correctedValue: 110000,
    correctionSource: "ANALYST_MANUAL",
    analystId: "analyst-1",
    correctedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("Learning Loop", () => {
  it("Test 1: validateAgainstCorpus passes for correct facts", () => {
    const corpus = GOLDEN_CORPUS[0];
    const facts: Record<string, number | null> = { ...corpus.groundTruth };
    const result = validateAgainstCorpus(corpus, facts);
    assert.equal(result.passed, true);
  });

  it("Test 2: validateAgainstCorpus fails and reports delta for wrong facts", () => {
    const corpus = GOLDEN_CORPUS[0];
    const facts: Record<string, number | null> = {
      ...corpus.groundTruth,
      GROSS_PROFIT: 500000, // wrong
    };
    const result = validateAgainstCorpus(corpus, facts);
    assert.equal(result.passed, false);
    const fail = result.failures.find((f) => f.factKey === "GROSS_PROFIT");
    assert.ok(fail);
    assert.equal(fail.delta, Math.abs(500000 - 797989));
  });

  it("Test 3: analyzePatterns — flags field when errorRate > 5%", () => {
    const corrections = Array.from({ length: 6 }, (_, i) =>
      makeCorrectionEvent({
        id: `corr-${i}`,
        correctedAt: new Date(Date.now() - i * 86400000).toISOString(),
      })
    );

    // 6 corrections out of 100 total = 6% error rate
    const totals: Record<string, number> = {
      "GROSS_RECEIPTS::FORM_1065": 100,
    };

    const patterns = analyzePatterns(corrections, totals);
    assert.equal(patterns.length, 1);
    assert.equal(patterns[0].flaggedForReview, true);
    assert.equal(patterns[0].errorRate, 0.06);
    assert.equal(patterns[0].correctionCount, 6);
  });

  it("Test 4: analyzePatterns — IMPROVING trend when recent rate lower than prior", () => {
    const now = Date.now();
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

    // 2 recent corrections (last 30 days)
    const recent = Array.from({ length: 2 }, (_, i) =>
      makeCorrectionEvent({
        id: `recent-${i}`,
        correctedAt: new Date(now - i * 86400000).toISOString(),
      })
    );

    // 10 prior corrections (30-60 days ago)
    const prior = Array.from({ length: 10 }, (_, i) =>
      makeCorrectionEvent({
        id: `prior-${i}`,
        correctedAt: new Date(
          now - THIRTY_DAYS - i * 86400000
        ).toISOString(),
      })
    );

    const totals: Record<string, number> = {
      "GROSS_RECEIPTS::FORM_1065": 200,
    };

    const patterns = analyzePatterns([...recent, ...prior], totals);
    assert.equal(patterns.length, 1);
    assert.equal(patterns[0].trend, "IMPROVING");
  });

  it("Test 5: analyzePatterns — DEGRADING trend when recent rate higher than prior", () => {
    const now = Date.now();
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

    // 10 recent corrections (last 30 days)
    const recent = Array.from({ length: 10 }, (_, i) =>
      makeCorrectionEvent({
        id: `recent-${i}`,
        correctedAt: new Date(now - i * 86400000).toISOString(),
      })
    );

    // 2 prior corrections (30-60 days ago)
    const prior = Array.from({ length: 2 }, (_, i) =>
      makeCorrectionEvent({
        id: `prior-${i}`,
        correctedAt: new Date(
          now - THIRTY_DAYS - i * 86400000
        ).toISOString(),
      })
    );

    const totals: Record<string, number> = {
      "GROSS_RECEIPTS::FORM_1065": 200,
    };

    const patterns = analyzePatterns([...recent, ...prior], totals);
    assert.equal(patterns.length, 1);
    assert.equal(patterns[0].trend, "DEGRADING");
  });

  it("Test 6: analyzePatterns — empty corrections return empty patterns", () => {
    const patterns = analyzePatterns([], {});
    assert.deepEqual(patterns, []);
  });
});
