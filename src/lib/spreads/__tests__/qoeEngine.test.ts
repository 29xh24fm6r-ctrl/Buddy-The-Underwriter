import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeQualityOfEarnings } from "../qoeEngine";
import type { QoEInput } from "../qoeEngine";

const BASE_INPUT: QoEInput = {
  reportedEbitda: 500_000,
  incomeItems: [],
  expenseItems: [],
  revenue: 2_000_000,
  priorYearBadDebt: null,
  priorYearLegalFees: null,
};

describe("QoE Engine", () => {
  it("returns high confidence with no adjustments when no non-recurring items", () => {
    const result = computeQualityOfEarnings(BASE_INPUT);
    assert.equal(result.adjustedEbitda, 500_000);
    assert.equal(result.adjustments.length, 0);
    assert.equal(result.confidence, "high");
  });

  it("deducts PPP loan forgiveness as non-recurring income", () => {
    const input: QoEInput = {
      ...BASE_INPUT,
      incomeItems: [
        { label: "PPP Loan Forgiveness", amount: 200_000, source: "P&L" },
      ],
    };
    const result = computeQualityOfEarnings(input);
    assert.equal(result.adjustments.length, 1);
    assert.equal(result.adjustments[0].direction, "deduct");
    assert.equal(result.adjustments[0].amount, 200_000);
    assert.equal(result.adjustedEbitda, 300_000);
  });

  it("adds back disaster loss as non-recurring expense", () => {
    const input: QoEInput = {
      ...BASE_INPUT,
      expenseItems: [
        { label: "Disaster loss from hurricane", amount: 100_000, source: "P&L" },
      ],
    };
    const result = computeQualityOfEarnings(input);
    assert.equal(result.adjustments.length, 1);
    assert.equal(result.adjustments[0].direction, "add_back");
    assert.equal(result.adjustedEbitda, 600_000);
  });

  it("flags gain on sale as non-recurring", () => {
    const input: QoEInput = {
      ...BASE_INPUT,
      incomeItems: [
        { label: "Gain on sale of equipment", amount: 50_000, source: "P&L" },
      ],
    };
    const result = computeQualityOfEarnings(input);
    assert.equal(result.adjustments.length, 1);
    assert.equal(result.adjustments[0].classification, "non_recurring_income");
  });

  it("flags ERC as non-recurring", () => {
    const input: QoEInput = {
      ...BASE_INPUT,
      incomeItems: [
        { label: "ERC credit received", amount: 75_000, source: "P&L" },
      ],
    };
    const result = computeQualityOfEarnings(input);
    assert.equal(result.adjustments.length, 1);
    assert.equal(result.adjustments[0].amount, 75_000);
  });

  it("flags bad debt spike >200% of prior year", () => {
    const input: QoEInput = {
      ...BASE_INPUT,
      priorYearBadDebt: 10_000,
      expenseItems: [
        { label: "Bad debt expense", amount: 25_000, source: "P&L" },
      ],
    };
    const result = computeQualityOfEarnings(input);
    assert.equal(result.adjustments.length, 1);
    assert.equal(result.adjustments[0].amount, 15_000); // 25k - 10k
    assert.equal(result.adjustments[0].documentationRequired, true);
  });

  it("flags legal fees spike >150% of prior year", () => {
    const input: QoEInput = {
      ...BASE_INPUT,
      priorYearLegalFees: 20_000,
      expenseItems: [
        { label: "Legal fees", amount: 40_000, source: "P&L" },
      ],
    };
    const result = computeQualityOfEarnings(input);
    assert.equal(result.adjustments.length, 1);
    assert.equal(result.adjustments[0].amount, 20_000); // 40k - 20k
  });

  it("flags large other income >5% of revenue", () => {
    const input: QoEInput = {
      ...BASE_INPUT,
      revenue: 1_000_000,
      incomeItems: [
        { label: "Other income", amount: 60_000, source: "P&L" },
      ],
    };
    const result = computeQualityOfEarnings(input);
    assert.equal(result.adjustments.length, 1);
    assert.equal(result.adjustments[0].documentationRequired, true);
  });

  it("returns low confidence when non-recurring > 20% of EBITDA", () => {
    const input: QoEInput = {
      ...BASE_INPUT,
      reportedEbitda: 500_000,
      incomeItems: [
        { label: "PPP forgiveness", amount: 300_000, source: "P&L" },
      ],
    };
    const result = computeQualityOfEarnings(input);
    assert.equal(result.confidence, "low");
  });

  it("returns medium confidence when uncertain items present", () => {
    const input: QoEInput = {
      ...BASE_INPUT,
      incomeItems: [
        { label: "Insurance proceeds from fire", amount: 30_000, source: "P&L" },
      ],
    };
    const result = computeQualityOfEarnings(input);
    assert.equal(result.confidence, "medium");
    assert.equal(result.adjustments[0].documentationRequired, true);
  });

  it("handles multiple adjustments in both directions", () => {
    const input: QoEInput = {
      ...BASE_INPUT,
      reportedEbitda: 500_000,
      incomeItems: [
        { label: "PPP forgiveness", amount: 100_000, source: "P&L" },
      ],
      expenseItems: [
        { label: "Severance payments", amount: 50_000, source: "P&L" },
      ],
    };
    const result = computeQualityOfEarnings(input);
    assert.equal(result.adjustments.length, 2);
    // -100k (deduct PPP) + 50k (add back severance) = -50k net
    assert.equal(result.adjustmentTotal, -50_000);
    assert.equal(result.adjustedEbitda, 450_000);
  });
});
