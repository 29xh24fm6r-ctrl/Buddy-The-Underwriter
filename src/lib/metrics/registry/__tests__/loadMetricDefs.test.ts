/**
 * Phase 13 — Registry Entry → MetricDefinition Mapper Tests
 *
 * Validates:
 * - Structured formula conversion
 * - Explicit dependsOn preserved
 * - dependsOn extracted from formula operands (non-numeric)
 * - Legacy expr parsing as fallback
 * - Batch conversion
 * - metricKey === def.key strict equality
 * - No nested dependency inference
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registryEntryToMetricDef, registryEntriesToMetricDefs } from "../loadMetricDefs";
import type { RegistryEntry } from "../types";

function makeEntry(overrides: Partial<RegistryEntry> & { definitionJson: Record<string, unknown> }): RegistryEntry {
  return {
    id: "entry-1",
    registryVersionId: "version-1",
    metricKey: "DSCR",
    definitionHash: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("Phase 13 — registryEntryToMetricDef", () => {
  it("converts structured formula correctly", () => {
    const entry = makeEntry({
      metricKey: "DSCR",
      definitionJson: {
        formula: { type: "divide", left: "EBITDA", right: "DEBT_SERVICE" },
        dependsOn: ["EBITDA", "DEBT_SERVICE"],
      },
    });

    const def = registryEntryToMetricDef(entry);

    assert.equal(def.key, "DSCR");
    assert.deepStrictEqual(def.formula, { type: "divide", left: "EBITDA", right: "DEBT_SERVICE" });
    assert.deepStrictEqual(def.dependsOn, ["EBITDA", "DEBT_SERVICE"]);
  });

  it("preserves explicit dependsOn even when formula differs", () => {
    const entry = makeEntry({
      metricKey: "CUSTOM",
      definitionJson: {
        formula: { type: "add", left: "A", right: "B" },
        dependsOn: ["A", "B", "C"], // Explicit includes extra dep
      },
    });

    const def = registryEntryToMetricDef(entry);

    assert.deepStrictEqual(def.dependsOn, ["A", "B", "C"]);
  });

  it("extracts dependsOn from formula operands when not explicitly provided", () => {
    const entry = makeEntry({
      metricKey: "DEBT_TO_EQUITY",
      definitionJson: {
        formula: { type: "divide", left: "TOTAL_DEBT", right: "EQUITY" },
      },
    });

    const def = registryEntryToMetricDef(entry);

    assert.deepStrictEqual(def.dependsOn, ["TOTAL_DEBT", "EQUITY"]);
  });

  it("excludes numeric literals from dependsOn", () => {
    const entry = makeEntry({
      metricKey: "SCALED_REVENUE",
      definitionJson: {
        formula: { type: "multiply", left: "REVENUE", right: "100" },
      },
    });

    const def = registryEntryToMetricDef(entry);

    assert.deepStrictEqual(def.dependsOn, ["REVENUE"]);
  });

  it("falls back to legacy expr parsing when no structured formula", () => {
    const entry = makeEntry({
      metricKey: "GROSS_MARGIN",
      definitionJson: {
        expr: "GROSS_PROFIT / REVENUE",
      },
    });

    const def = registryEntryToMetricDef(entry);

    assert.equal(def.formula.type, "divide");
    assert.equal(def.formula.left, "GROSS_PROFIT");
    assert.equal(def.formula.right, "REVENUE");
    assert.deepStrictEqual(def.dependsOn, ["GROSS_PROFIT", "REVENUE"]);
  });

  it("throws when neither formula nor expr is provided", () => {
    const entry = makeEntry({
      metricKey: "BROKEN",
      definitionJson: {},
    });

    assert.throws(() => registryEntryToMetricDef(entry), /BROKEN/);
  });

  it("enforces metricKey === def.key strict equality", () => {
    const entry = makeEntry({
      metricKey: "MY_METRIC",
      definitionJson: {
        formula: { type: "add", left: "A", right: "B" },
      },
    });

    const def = registryEntryToMetricDef(entry);

    assert.equal(def.key, entry.metricKey);
    assert.equal(def.key, "MY_METRIC");
  });

  it("preserves description and regulatoryReference", () => {
    const entry = makeEntry({
      metricKey: "DSCR",
      definitionJson: {
        formula: { type: "divide", left: "EBITDA", right: "DEBT_SERVICE" },
        description: "Debt Service Coverage Ratio",
        regulatoryReference: "SBA SOP 50 10 7",
      },
    });

    const def = registryEntryToMetricDef(entry);

    assert.equal(def.description, "Debt Service Coverage Ratio");
    assert.equal(def.regulatoryReference, "SBA SOP 50 10 7");
  });
});

describe("Phase 13 — registryEntriesToMetricDefs", () => {
  it("batch converts multiple entries", () => {
    const entries: RegistryEntry[] = [
      makeEntry({
        id: "e1",
        metricKey: "DSCR",
        definitionJson: {
          formula: { type: "divide", left: "EBITDA", right: "DEBT_SERVICE" },
          dependsOn: ["EBITDA", "DEBT_SERVICE"],
        },
      }),
      makeEntry({
        id: "e2",
        metricKey: "DEBT_TO_EQUITY",
        definitionJson: {
          formula: { type: "divide", left: "TOTAL_DEBT", right: "EQUITY" },
        },
      }),
    ];

    const defs = registryEntriesToMetricDefs(entries);

    assert.equal(defs.length, 2);
    assert.equal(defs[0].key, "DSCR");
    assert.equal(defs[1].key, "DEBT_TO_EQUITY");
  });

  it("returns empty array for empty input", () => {
    const defs = registryEntriesToMetricDefs([]);
    assert.deepStrictEqual(defs, []);
  });
});
