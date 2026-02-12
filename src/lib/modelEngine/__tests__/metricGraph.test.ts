import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  topologicalSort,
  evaluateFormula,
  evaluateMetricGraph,
  evaluateFormulaWithDiagnostics,
  evaluateMetricGraphWithDiagnostics,
} from "../metricGraph";
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

// ===================================================================
// evaluateFormulaWithDiagnostics
// ===================================================================

describe("evaluateFormulaWithDiagnostics", () => {
  const values: Record<string, number | null> = {
    REVENUE: 1000000,
    EBITDA: 500000,
  };

  it("returns value for valid formula", () => {
    const formula: FormulaNode = { type: "divide", left: "REVENUE", right: "EBITDA" };
    const result = evaluateFormulaWithDiagnostics(formula, values);
    assert.equal(result.value, 2);
    assert.equal(result.error, undefined);
  });

  it("returns MISSING_DEPENDENCY for missing left operand", () => {
    const formula: FormulaNode = { type: "divide", left: "CFADS", right: "EBITDA" };
    const result = evaluateFormulaWithDiagnostics(formula, values, "DSCR");
    assert.equal(result.value, null);
    assert.ok(result.error);
    assert.equal(result.error.code, "MISSING_DEPENDENCY");
    assert.ok(result.error.message.includes("CFADS"));
    assert.ok(result.error.message.includes("DSCR"));
  });

  it("returns MISSING_DEPENDENCY for missing right operand", () => {
    const formula: FormulaNode = { type: "divide", left: "REVENUE", right: "DEBT_SERVICE" };
    const result = evaluateFormulaWithDiagnostics(formula, values);
    assert.equal(result.value, null);
    assert.ok(result.error);
    assert.equal(result.error.code, "MISSING_DEPENDENCY");
    assert.ok(result.error.message.includes("DEBT_SERVICE"));
  });

  it("returns DIVIDE_BY_ZERO for zero denominator", () => {
    const formula: FormulaNode = { type: "divide", left: "REVENUE", right: "0" };
    const result = evaluateFormulaWithDiagnostics(formula, values, "BAD_RATIO");
    assert.equal(result.value, null);
    assert.ok(result.error);
    assert.equal(result.error.code, "DIVIDE_BY_ZERO");
    assert.ok(result.error.message.includes("BAD_RATIO"));
  });

  it("returns INVALID_OP for bad operation", () => {
    const formula = { type: "modulo" as any, left: "REVENUE", right: "EBITDA" };
    const result = evaluateFormulaWithDiagnostics(formula, values);
    assert.equal(result.value, null);
    assert.ok(result.error);
    assert.equal(result.error.code, "INVALID_OP");
  });
});

// ===================================================================
// evaluateMetricGraphWithDiagnostics
// ===================================================================

describe("evaluateMetricGraphWithDiagnostics", () => {
  it("collects diagnostics for missing dependencies", () => {
    const metrics: MetricDefinition[] = [
      {
        id: "1", version: "v1", key: "DSCR",
        dependsOn: ["CFADS", "DEBT_SERVICE"],
        formula: { type: "divide", left: "CFADS", right: "DEBT_SERVICE" },
      },
    ];

    const result = evaluateMetricGraphWithDiagnostics(metrics, { CFADS: 500000 });
    assert.equal(result.values["DSCR"], null);
    assert.ok(result.diagnostics.length >= 1);
    assert.equal(result.diagnostics[0].code, "MISSING_DEPENDENCY");
    assert.equal(result.diagnostics[0].metric, "DSCR");
  });

  it("detects circular dependencies", () => {
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

    const result = evaluateMetricGraphWithDiagnostics(metrics, {});
    assert.ok(result.diagnostics.length >= 1);
    assert.equal(result.diagnostics[0].code, "CYCLE_DETECTED");
  });

  it("returns clean diagnostics for valid graph", () => {
    const metrics: MetricDefinition[] = [
      {
        id: "1", version: "v1", key: "NET_MARGIN",
        dependsOn: ["NET_INCOME", "REVENUE"],
        formula: { type: "divide", left: "NET_INCOME", right: "REVENUE" },
      },
    ];

    const result = evaluateMetricGraphWithDiagnostics(metrics, {
      NET_INCOME: 200000,
      REVENUE: 1000000,
    });
    assert.ok(Math.abs((result.values["NET_MARGIN"] ?? 0) - 0.2) < 0.001);
    assert.equal(result.diagnostics.length, 0);
  });

  it("collects multiple diagnostics across metrics", () => {
    const metrics: MetricDefinition[] = [
      {
        id: "1", version: "v1", key: "DSCR",
        dependsOn: ["CFADS", "DEBT_SERVICE"],
        formula: { type: "divide", left: "CFADS", right: "DEBT_SERVICE" },
      },
      {
        id: "2", version: "v1", key: "LEVERAGE",
        dependsOn: ["TOTAL_DEBT", "EBITDA"],
        formula: { type: "divide", left: "TOTAL_DEBT", right: "EBITDA" },
      },
    ];

    // Neither has required dependencies
    const result = evaluateMetricGraphWithDiagnostics(metrics, {});
    assert.equal(result.values["DSCR"], null);
    assert.equal(result.values["LEVERAGE"], null);
    assert.ok(result.diagnostics.length >= 2);
    assert.ok(result.diagnostics.some((d) => d.metric === "DSCR"));
    assert.ok(result.diagnostics.some((d) => d.metric === "LEVERAGE"));
  });
});
