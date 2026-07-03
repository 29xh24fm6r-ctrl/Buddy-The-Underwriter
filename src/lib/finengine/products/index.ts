/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 7: Product Intelligence Framework.
 *
 * Barrel for the product intelligence framework. All 14 canonical products
 * compile through the common `ProductDefinition` contract. No product writes
 * facts — this layer is pure data + pure readiness evaluation.
 */

export * from "@/lib/finengine/products/productContract";
export * from "@/lib/finengine/products/requiredDocuments";
export * from "@/lib/finengine/products/productRiskFactors";
export * from "@/lib/finengine/products/productCovenants";
export * from "@/lib/finengine/products/missingDataBlockers";
