/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 1 tests.
 *
 * The load-bearing assertion is the acceptance criterion: every known STANDARD
 * spread formula alias resolves to a canonical METRIC_REGISTRY mapping (or is an
 * explicitly-classified structural/passthrough non-metric). Plus: the alias
 * normalizer, the formula dependency graph, the duplicated-source report, and
 * the drift audits all behave, and the registry is drift-free on current main.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { STANDARD_FORMULAS } from "@/lib/financialSpreads/standard/formulas/registry";
import {
  CANONICAL_METRIC_IDS,
  getMetricDefinition,
  isCanonicalMetric,
  metricDependencies,
  buildFormulaDependencyGraph,
  classifyDependency,
  transitiveFactLeaves,
  exprIdentifiers,
  NULL_HANDLING_POLICY,
} from "@/lib/finengine/registry/metricRegistry";
import {
  normalizeFormulaAlias,
  resolveFormulaAlias,
  FORMULA_ALIAS_MAP,
  SUPPLEMENTAL_ALIASES,
  canonicalAliases,
} from "@/lib/finengine/registry/formulaRegistry";
import { partitionFactKeys } from "@/lib/finengine/registry/factKeyRegistry";
import {
  PRODUCT_KEYS,
  requiredMetricsForProduct,
  allRequiredProductMetrics,
} from "@/lib/finengine/registry/productMetricRegistry";
import {
  auditAliasCoverage,
  auditDuplicatedFormulaSources,
  auditFactKeyMetricDrift,
  auditProductMetrics,
  runRegistryAudit,
} from "@/lib/finengine/registry/registryAudit";

describe("PR1 — STANDARD spread alias → canonical registry mapping (acceptance)", () => {
  it("every STANDARD formula with a metricRegistryId resolves to a real canonical metric", () => {
    for (const [alias, formula] of Object.entries(STANDARD_FORMULAS)) {
      if (!formula.metricRegistryId) continue; // structural/passthrough handled below
      const canonical = normalizeFormulaAlias(alias);
      assert.equal(
        canonical,
        formula.metricRegistryId,
        `alias ${alias} should normalize to its metricRegistryId ${formula.metricRegistryId}`,
      );
      assert.ok(
        CANONICAL_METRIC_IDS.has(canonical!),
        `alias ${alias} → ${canonical} must exist in METRIC_REGISTRY`,
      );
    }
  });

  it("every STANDARD formula alias is represented in FORMULA_ALIAS_MAP", () => {
    for (const alias of Object.keys(STANDARD_FORMULAS)) {
      assert.ok(FORMULA_ALIAS_MAP[alias], `alias ${alias} missing from FORMULA_ALIAS_MAP`);
    }
  });

  it("alias-coverage audit reports no dangling canonical ids", () => {
    const report = auditAliasCoverage();
    assert.deepEqual(report.danglingCanonical, []);
    assert.equal(report.ok, true);
    assert.ok(report.resolved.length > 0);
  });
});

describe("PR1 — alias normalization", () => {
  it("passes an already-canonical id through unchanged", () => {
    assert.equal(normalizeFormulaAlias("DSCR"), "DSCR");
  });

  it("returns null for a structural alias (no single canonical metric)", () => {
    // TOTAL_CURRENT_ASSETS is a renderer-owned structural sum (metricRegistryId: null).
    assert.equal(normalizeFormulaAlias("TOTAL_CURRENT_ASSETS"), null);
    const res = resolveFormulaAlias("TOTAL_CURRENT_ASSETS");
    assert.equal(res?.kind, "structural");
  });

  it("returns null for a passthrough alias (raw fact identity)", () => {
    const res = resolveFormulaAlias("TOTAL_REVENUE");
    assert.equal(res?.kind, "passthrough");
    assert.equal(normalizeFormulaAlias("TOTAL_REVENUE"), null);
  });

  it("resolves cross-surface supplemental aliases to real canonical metrics", () => {
    for (const [alias, target] of Object.entries(SUPPLEMENTAL_ALIASES)) {
      assert.equal(normalizeFormulaAlias(alias), target, `supplemental ${alias}`);
      assert.ok(CANONICAL_METRIC_IDS.has(target), `supplemental target ${target} must be canonical`);
    }
  });

  it("returns null for an unknown alias (never throws)", () => {
    assert.equal(normalizeFormulaAlias("NOT_A_REAL_METRIC_XYZ"), null);
    assert.equal(resolveFormulaAlias("NOT_A_REAL_METRIC_XYZ"), null);
  });

  it("canonicalAliases() are all kind=canonical with a metric id", () => {
    for (const res of canonicalAliases()) {
      assert.equal(res.kind, "canonical");
      assert.ok(res.canonicalMetricId && CANONICAL_METRIC_IDS.has(res.canonicalMetricId));
    }
  });
});

describe("PR1 — formula dependency graph", () => {
  it("extracts direct dependencies from a metric expr", () => {
    assert.deepEqual(metricDependencies("DSCR"), ["CASH_FLOW_AVAILABLE", "ANNUAL_DEBT_SERVICE"]);
    assert.deepEqual(metricDependencies("NOI"), ["TOTAL_INCOME", "TOTAL_OPEX"]);
  });

  it("exprIdentifiers ignores numbers and operators, de-dups, preserves order", () => {
    assert.deepEqual(exprIdentifiers("A / B * 365 + A"), ["A", "B"]);
  });

  it("classifies a dependency as metric vs fact leaf", () => {
    // TOTAL_INCOME is itself a metric; GROSS_RENTAL_INCOME is a raw fact leaf.
    assert.equal(classifyDependency("TOTAL_INCOME"), "metric");
    assert.equal(classifyDependency("GROSS_RENTAL_INCOME"), "fact");
  });

  it("expands transitive fact leaves through nested metrics", () => {
    // NOI = TOTAL_INCOME - TOTAL_OPEX; both are metrics → leaves are their fact inputs.
    const leaves = transitiveFactLeaves("NOI");
    assert.ok(leaves.includes("GROSS_RENTAL_INCOME"), "NOI should read GROSS_RENTAL_INCOME");
    // No metric ids should survive as "leaves".
    for (const l of leaves) assert.equal(classifyDependency(l), "fact");
  });

  it("dependency graph covers every registry metric", () => {
    const graph = buildFormulaDependencyGraph();
    assert.equal(Object.keys(graph).length, CANONICAL_METRIC_IDS.size);
    for (const id of CANONICAL_METRIC_IDS) assert.ok(Array.isArray(graph[id]));
  });

  it("getMetricDefinition / isCanonicalMetric behave", () => {
    assert.ok(isCanonicalMetric("DSCR"));
    assert.equal(isCanonicalMetric("NOPE_XYZ"), false);
    assert.equal(getMetricDefinition("DSCR")?.id, "DSCR");
    assert.equal(getMetricDefinition("NOPE_XYZ"), null);
  });
});

describe("PR1 — duplicated formula sources report", () => {
  it("classifies STANDARD formulas as delegation / structural / passthrough", () => {
    const report = auditDuplicatedFormulaSources();
    const total = report.counts.delegation + report.counts.structural + report.counts.passthrough;
    assert.equal(total, Object.keys(STANDARD_FORMULAS).length);
    assert.ok(report.counts.delegation > 0, "most formulas delegate to the central registry");
    // Structural formula ids are exactly the non-null-metric, non-identity exprs.
    assert.ok(report.structuralFormulaIds.includes("TOTAL_CURRENT_ASSETS"));
    assert.ok(!report.structuralFormulaIds.includes("DSCR"));
  });

  it("no delegation entry is also flagged structural", () => {
    const report = auditDuplicatedFormulaSources();
    const delegations = new Set(
      report.entries.filter((e) => e.kind === "delegation").map((e) => e.id),
    );
    for (const id of report.structuralFormulaIds) assert.equal(delegations.has(id), false);
  });
});

describe("PR1 — fact-key / metric-registry drift (informational)", () => {
  it("produces a symmetric difference report without throwing", () => {
    const report = auditFactKeyMetricDrift();
    assert.ok(Array.isArray(report.inVocabNotInRegistry));
    assert.ok(Array.isArray(report.inRegistryNotInVocab));
    // Sanity: DSCR is in both vocab and registry, so it appears in neither diff.
    assert.ok(!report.inVocabNotInRegistry.includes("DSCR"));
    assert.ok(!report.inRegistryNotInVocab.includes("DSCR"));
  });
});

describe("PR1 — product metric integrity", () => {
  it("every product's required metrics exist in the registry", () => {
    const report = auditProductMetrics();
    assert.deepEqual(report.unknownMetrics, []);
    assert.equal(report.ok, true);
  });

  it("all 14 products declare at least one required metric", () => {
    assert.equal(PRODUCT_KEYS.length, 14);
    for (const p of PRODUCT_KEYS) assert.ok(requiredMetricsForProduct(p).length > 0, p);
  });

  it("the required-metric union is a subset of the canonical registry", () => {
    for (const m of allRequiredProductMetrics()) assert.ok(CANONICAL_METRIC_IDS.has(m), m);
  });
});

describe("PR1 — fact-key partitioning + policy", () => {
  it("partitions keys into canonical / extraction / unknown", () => {
    const part = partitionFactKeys(["DSCR", "SL_CASH", "TOTAL_INCOME", "ZZZ_UNKNOWN"]);
    assert.ok(part.canonicalMetric.includes("DSCR"));
    assert.ok(part.extraction.includes("SL_CASH")); // SL_ prefix
    assert.ok(part.extraction.includes("TOTAL_INCOME")); // known extraction key
    assert.ok(part.unknown.includes("ZZZ_UNKNOWN"));
  });

  it("null-handling policy is the documented contract", () => {
    assert.equal(NULL_HANDLING_POLICY.divideByZeroYieldsNull, true);
    assert.equal(NULL_HANDLING_POLICY.missingInputsReportedNotZeroed, true);
  });
});

describe("PR1 — full audit gate", () => {
  it("runRegistryAudit is green on current registries", () => {
    const report = runRegistryAudit();
    assert.equal(report.ok, true, JSON.stringify({
      dangling: report.aliasCoverage.danglingCanonical,
      unknownProductMetrics: report.productMetrics.unknownMetrics,
    }));
  });
});
