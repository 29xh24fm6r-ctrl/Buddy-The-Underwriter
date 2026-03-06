import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateAgainstCorpus } from "../corpusValidator";
import { GOLDEN_CORPUS } from "../goldenDocuments";

describe("Golden Corpus Validator", () => {
  const samaritus2022 = GOLDEN_CORPUS.find(
    (d) => d.id === "samaritus_2022_1065"
  )!;
  const samaritus2024 = GOLDEN_CORPUS.find(
    (d) => d.id === "samaritus_2024_1065"
  )!;

  it("Test 1: Samaritus 2022 — all ground truth keys pass", () => {
    const facts: Record<string, number | null> = {
      GROSS_RECEIPTS: 797989,
      COST_OF_GOODS_SOLD: 0,
      GROSS_PROFIT: 797989,
      TOTAL_DEDUCTIONS: 472077,
      ORDINARY_BUSINESS_INCOME: 325912,
      DEPRECIATION: 191385,
      INTEREST_EXPENSE: 9068,
    };

    const result = validateAgainstCorpus(samaritus2022, facts);
    assert.equal(result.passed, true);
    assert.equal(result.failures.length, 0);
    assert.equal(result.documentId, "samaritus_2022_1065");
  });

  it("Test 2: Samaritus 2024 — all ground truth keys pass", () => {
    const facts: Record<string, number | null> = {
      GROSS_RECEIPTS: 1502871,
      COST_OF_GOODS_SOLD: 449671,
      GROSS_PROFIT: 1053200,
      TOTAL_DEDUCTIONS: 783384,
      ORDINARY_BUSINESS_INCOME: 269816,
      DEPRECIATION: 287050,
      INTEREST_EXPENSE: 12112,
    };

    const result = validateAgainstCorpus(samaritus2024, facts);
    assert.equal(result.passed, true);
    assert.equal(result.failures.length, 0);
    assert.equal(result.documentId, "samaritus_2024_1065");
  });

  it("Test 3: Introduced regression — GROSS_PROFIT wrong → test fails, delta reported", () => {
    const facts: Record<string, number | null> = {
      GROSS_RECEIPTS: 797989,
      COST_OF_GOODS_SOLD: 0,
      GROSS_PROFIT: 700000, // wrong — should be 797989
      TOTAL_DEDUCTIONS: 472077,
      ORDINARY_BUSINESS_INCOME: 325912,
      DEPRECIATION: 191385,
      INTEREST_EXPENSE: 9068,
    };

    const result = validateAgainstCorpus(samaritus2022, facts);
    assert.equal(result.passed, false);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].factKey, "GROSS_PROFIT");
    assert.equal(result.failures[0].expected, 797989);
    assert.equal(result.failures[0].actual, 700000);
    assert.equal(result.failures[0].delta, 97989);
  });

  it("Test 4: OBI-as-revenue regression — GROSS_RECEIPTS = OBI value → fails", () => {
    const facts: Record<string, number | null> = {
      GROSS_RECEIPTS: 269816, // wrong — OBI value used as revenue
      COST_OF_GOODS_SOLD: 449671,
      GROSS_PROFIT: 1053200,
      TOTAL_DEDUCTIONS: 783384,
      ORDINARY_BUSINESS_INCOME: 269816,
      DEPRECIATION: 287050,
      INTEREST_EXPENSE: 12112,
    };

    const result = validateAgainstCorpus(samaritus2024, facts);
    assert.equal(result.passed, false);

    const grFail = result.failures.find(
      (f) => f.factKey === "GROSS_RECEIPTS"
    );
    assert.ok(grFail, "GROSS_RECEIPTS should be in failures");
    assert.equal(grFail.expected, 1502871);
    assert.equal(grFail.actual, 269816);
  });

  it("Test 5: Missing fact → delta reported, test fails unless ground truth is null", () => {
    const facts: Record<string, number | null> = {
      GROSS_RECEIPTS: 797989,
      COST_OF_GOODS_SOLD: 0,
      GROSS_PROFIT: 797989,
      TOTAL_DEDUCTIONS: 472077,
      ORDINARY_BUSINESS_INCOME: 325912,
      DEPRECIATION: 191385,
      // INTEREST_EXPENSE missing
    };

    const result = validateAgainstCorpus(samaritus2022, facts);
    assert.equal(result.passed, false);

    const ieFail = result.failures.find(
      (f) => f.factKey === "INTEREST_EXPENSE"
    );
    assert.ok(ieFail, "INTEREST_EXPENSE should be in failures");
    assert.equal(ieFail.expected, 9068);
    assert.equal(ieFail.actual, null);
    assert.equal(ieFail.delta, null);
  });
});
