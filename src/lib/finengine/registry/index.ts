/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 1: Finengine Registry Consolidation.
 *
 * Barrel for the unified finengine registry package. Import canonical metric,
 * fact-key, formula-alias, product-metric, and audit surfaces from here.
 *
 * This package owns NO new formulas — it is a consolidation/indirection layer
 * over the existing authoritative sources (central METRIC_REGISTRY, STANDARD
 * spread formulas, finengine fact-key vocabulary). See each module header.
 */

export * from "@/lib/finengine/registry/metricRegistry";
export * from "@/lib/finengine/registry/factKeyRegistry";
export * from "@/lib/finengine/registry/formulaRegistry";
export * from "@/lib/finengine/registry/productMetricRegistry";
export * from "@/lib/finengine/registry/registryAudit";
