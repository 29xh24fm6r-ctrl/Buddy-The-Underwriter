/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 1: Finengine Registry Consolidation.
 *
 * REGISTRY AUDIT — the drift detector. Pure, read-only reconciliation across the
 * three authoritative registries the finengine now consolidates:
 *   - central METRIC_REGISTRY        (the one formula source)
 *   - STANDARD_FORMULAS alias map    (what the STANDARD spread renders)
 *   - finengine fact-key vocabulary  (CANONICAL_METRIC_KEYS)
 *   - product required-metric map    (PR 7 seed)
 *
 * It answers PR 1's acceptance questions:
 *   1. Does every STANDARD spread alias resolve to a canonical registry mapping?
 *   2. Where do formulas live OUTSIDE the central registry (duplicated sources)?
 *   3. Where do the fact-key vocabulary and the metric registry disagree?
 *
 * No side effects, no throws — returns a structured report a test (or a future
 * CI guard) asserts on. Green = no drift.
 */

import { STANDARD_FORMULAS } from "@/lib/financialSpreads/standard/formulas/registry";
import { CANONICAL_METRIC_IDS } from "@/lib/finengine/registry/metricRegistry";
import { FORMULA_ALIAS_MAP, type FormulaAliasResolution } from "@/lib/finengine/registry/formulaRegistry";
import { CANONICAL_METRIC_KEYS } from "@/lib/finengine/registry/factKeyRegistry";
import {
  PRODUCT_KEYS,
  REQUIRED_METRICS_BY_PRODUCT,
} from "@/lib/finengine/registry/productMetricRegistry";

// ── 1. Alias coverage ─────────────────────────────────────────────────────────

export type AliasCoverageReport = {
  /** Aliases whose canonicalMetricId points at a real METRIC_REGISTRY entry. */
  resolved: string[];
  /** Structural / passthrough aliases (intentionally no single canonical metric). */
  nonMetric: string[];
  /** DRIFT: alias claims a canonical metric id that does not exist in the registry. */
  danglingCanonical: { alias: string; missingMetricId: string }[];
  ok: boolean;
};

export function auditAliasCoverage(): AliasCoverageReport {
  const resolved: string[] = [];
  const nonMetric: string[] = [];
  const danglingCanonical: { alias: string; missingMetricId: string }[] = [];

  for (const res of Object.values(FORMULA_ALIAS_MAP) as FormulaAliasResolution[]) {
    if (res.canonicalMetricId === null) {
      nonMetric.push(res.alias);
      continue;
    }
    if (CANONICAL_METRIC_IDS.has(res.canonicalMetricId)) {
      resolved.push(res.alias);
    } else {
      danglingCanonical.push({ alias: res.alias, missingMetricId: res.canonicalMetricId });
    }
  }

  return {
    resolved,
    nonMetric,
    danglingCanonical,
    ok: danglingCanonical.length === 0,
  };
}

// ── 2. Duplicated formula sources ─────────────────────────────────────────────

export type FormulaSourceKind =
  /** Delegates to the central registry via metricRegistryId — NOT a duplicate. */
  | "delegation"
  /** Renderer-owned structural aggregation (subtotal/balance check) — no metric equivalent. */
  | "structural"
  /** Identity pass-through of a raw fact key. */
  | "passthrough";

export type DuplicatedFormulaSourcesReport = {
  /** Every STANDARD_FORMULAS entry classified by how it relates to the registry. */
  entries: { id: string; kind: FormulaSourceKind; expr: string }[];
  counts: Record<FormulaSourceKind, number>;
  /**
   * True structural formulas that carry real arithmetic but have NO central
   * registry entry. These are the only "second source" of math in the STANDARD
   * spread and are the burn-down candidates a later PR must fold in or bless.
   */
  structuralFormulaIds: string[];
};

export function auditDuplicatedFormulaSources(): DuplicatedFormulaSourcesReport {
  const entries: { id: string; kind: FormulaSourceKind; expr: string }[] = [];
  const counts: Record<FormulaSourceKind, number> = {
    delegation: 0,
    structural: 0,
    passthrough: 0,
  };
  const structuralFormulaIds: string[] = [];

  for (const [id, f] of Object.entries(STANDARD_FORMULAS)) {
    let kind: FormulaSourceKind;
    if (f.metricRegistryId) {
      kind = "delegation";
    } else if (/^[A-Z][A-Z0-9_]*$/.test(f.expr.trim())) {
      kind = "passthrough";
    } else {
      kind = "structural";
      structuralFormulaIds.push(id);
    }
    counts[kind] += 1;
    entries.push({ id, kind, expr: f.expr });
  }

  return { entries, counts, structuralFormulaIds };
}

// ── 3. Fact-key vs metric-registry drift ──────────────────────────────────────

export type FactKeyMetricDriftReport = {
  /** Fact keys the finengine vocabulary marks canonical-metric but the registry lacks. */
  inVocabNotInRegistry: string[];
  /** Canonical metrics in the registry not present in the fact-key vocabulary. */
  inRegistryNotInVocab: string[];
};

export function auditFactKeyMetricDrift(): FactKeyMetricDriftReport {
  const inVocabNotInRegistry: string[] = [];
  for (const k of CANONICAL_METRIC_KEYS) {
    if (!CANONICAL_METRIC_IDS.has(k)) inVocabNotInRegistry.push(k);
  }
  const inRegistryNotInVocab: string[] = [];
  for (const id of CANONICAL_METRIC_IDS) {
    if (!CANONICAL_METRIC_KEYS.has(id)) inRegistryNotInVocab.push(id);
  }
  return {
    inVocabNotInRegistry: inVocabNotInRegistry.sort(),
    inRegistryNotInVocab: inRegistryNotInVocab.sort(),
  };
}

// ── 4. Product required-metric integrity ──────────────────────────────────────

export type ProductMetricAuditReport = {
  /** DRIFT: product declares a required metric id absent from the registry. */
  unknownMetrics: { product: string; metricId: string }[];
  ok: boolean;
};

export function auditProductMetrics(): ProductMetricAuditReport {
  const unknownMetrics: { product: string; metricId: string }[] = [];
  for (const product of PRODUCT_KEYS) {
    for (const metricId of REQUIRED_METRICS_BY_PRODUCT[product]) {
      if (!CANONICAL_METRIC_IDS.has(metricId)) {
        unknownMetrics.push({ product, metricId });
      }
    }
  }
  return { unknownMetrics, ok: unknownMetrics.length === 0 };
}

// ── Full audit ────────────────────────────────────────────────────────────────

export type RegistryAuditReport = {
  aliasCoverage: AliasCoverageReport;
  duplicatedFormulaSources: DuplicatedFormulaSourcesReport;
  factKeyMetricDrift: FactKeyMetricDriftReport;
  productMetrics: ProductMetricAuditReport;
  /**
   * Hard-drift gate: true when nothing that MUST be consistent is inconsistent.
   * Note: fact-key/metric-registry set differences are informational (the two
   * vocabularies legitimately cover different surfaces), so they do NOT fail the
   * gate — only dangling aliases and unknown product metrics do.
   */
  ok: boolean;
};

export function runRegistryAudit(): RegistryAuditReport {
  const aliasCoverage = auditAliasCoverage();
  const duplicatedFormulaSources = auditDuplicatedFormulaSources();
  const factKeyMetricDrift = auditFactKeyMetricDrift();
  const productMetrics = auditProductMetrics();
  return {
    aliasCoverage,
    duplicatedFormulaSources,
    factKeyMetricDrift,
    productMetrics,
    ok: aliasCoverage.ok && productMetrics.ok,
  };
}
