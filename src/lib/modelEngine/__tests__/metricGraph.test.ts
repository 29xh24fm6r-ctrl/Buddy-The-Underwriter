import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { topologicalSort, evaluateFormula, evaluateMetricGraph } from "../metricGraph";
import type { MetricDefinition, FormulaNode } from "../types";

describe("evaluateFormula", () => {
  const values: Record<string, number | null> = {
    REVENUE: 1000000,
    COGS: 400000,
    EBITDA: 500000,
    TOTAL_DEBT: 2000000,
    EQUITY: 800000,
    NET_INCOME: 200000,
    TOTAL_ASSETS: 3000000,
  };

  it("add", () => {
    const formula: FormulaNode = { type: "add", left: "REVENUE", right: "COGS" };
    assert.equal(evaluateFormula(formula, values), 1400000);
  });

  it("subtract", () => {
    const formula: FormulaNode = { type: "subtract", left: "REVENUE", right: "COGS" };
    assert.equal(evaluateFormula(formula, values), 600000);
  });

  it("multiply with numeric literal", () => {
    const formula: FormulaNode = { type: "multiply", left: "EBITDA", right: "2" };
    assert.equal(evaluateFormula(formula, values), 1000000);
  });

  it("divide", () => {
    const formula: FormulaNode = { type: "divide", left: "NET_INCOME", right: "REVENUE" };
    assert.equal(evaluateFormula(formula, values), 0.2);
  });

  it("divide by zero returns null", () => {
    const formula: FormulaNode = { type: "divide", left: "REVENUE", right: "0" };
    assert.equal(evaluateFormula(formula, { REVENUE: 1000 }), null);
  });

  it("missing operand returns null", () => {
    const formula: FormulaNode = { type: "divide", left: "CFADS", right: "DEBT_SERVICE" };
    assert.equal(evaluateFormula(formula, values), null);
  });

  it("invalid op returns null", () => {
    const formula = { type: "power" as any, left: "REVENUE", right: "2" };
    assert.equal(evaluateFormula(formula, values), null);
  });

  it("numeric literal operands", () => {
    const formula: FormulaNode = { type: "add", left: "100", right: "200" };
    assert.equal(evaluateFormula(formula, {}), 300);
  });
});

describe("topologicalSort", () => {
  it("sorts metrics by dependencies", () => {
    const metrics: MetricDefinition[] = [
      {
        id: "1", version: "v1", key: "NET_MARGIN",
        dependsOn: ["NET_INCOME", "REVENUE"],
        formula: { type: "divide", left: "NET_INCOME", right: "REVENUE" },
      },
      {
        id: "2", version: "v1", key: "LEVERAGE",
        dependsOn: ["TOTAL_DEBT", "EBITDA"],
        formula: { type: "divide", left: "TOTAL_DEBT", right: "EBITDA" },
      },
    ];

    const sorted = topologicalSort(metrics);
    assert.equal(sorted.length, 2);
    const keys = sorted.map((s) => s.key).sort();
    assert.deepEqual(keys, ["LEVERAGE", "NET_MARGIN"]);
  });

  it("detects cycles", () => {
    const metrics: MetricDefinition[] = [
      {
        id: "1", version: "v1", key: "A",
        dependsOn: ["B"],
        formula: { type: "add", left: "B", right: "1" },
      },
      {
        id: "2", version: "v1", key: "B",
        dependsOn: ["A"],
        formula: { type: "add", left: "A", right: "1" },
      },
    ];

    assert.throws(() => topologicalSort(metrics), /Cycle detected/);
  });

  it("handles empty input", () => {
    assert.deepEqual(topologicalSort([]), []);
  });
});

describe("evaluateMetricGraph", () => {
  it("evaluates metrics with dependencies", () => {
    const metrics: MetricDefinition[] = [
      {
        id: "1", version: "v1", key: "GROSS_MARGIN",
        dependsOn: ["GROSS_PROFIT", "REVENUE"],
        formula: { type: "divide", left: "GROSS_PROFIT", right: "REVENUE" },
      },
      {
        id: "2", version: "v1", key: "LEVERAGE",
        dependsOn: ["TOTAL_DEBT", "EBITDA"],
        formula: { type: "divide", left: "TOTAL_DEBT", right: "EBITDA" },
      },
    ];

    const baseValues = {
      GROSS_PROFIT: 600000,
      REVENUE: 1000000,
      TOTAL_DEBT: 2000000,
      EBITDA: 500000,
    };

    const result = evaluateMetricGraph(metrics, baseValues);
    assert.ok(Math.abs((result["GROSS_MARGIN"] ?? 0) - 0.6) < 0.001);
    assert.equal(result["LEVERAGE"], 4);
    assert.equal(result["REVENUE"], 1000000);
  });

  it("null propagation when dependency missing", () => {
    const metrics: MetricDefinition[] = [
      {
        id: "1", version: "v1", key: "DSCR",
        dependsOn: ["CFADS", "DEBT_SERVICE"],
        formula: { type: "divide", left: "CFADS", right: "DEBT_SERVICE" },
      },
    ];

    const result = evaluateMetricGraph(metrics, { CFADS: 500000 });
    assert.equal(result["DSCR"], null);
  });
});
