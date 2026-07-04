/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 7: Product Intelligence Framework.
 *
 * The COMMON product contract every loan product compiles through. Required
 * metrics are sourced from PR 1's `productMetricRegistry` (single source, already
 * registry-validated) — this layer adds required documents, recommended covenant
 * packages, and a risk-factor model, then a missing-data blocker system.
 *
 * Product-key note: this contract is keyed on the 14 canonical `ProductKey`s
 * from PR 1. A pure inventory revolver is underwritten as an `ABL_REVOLVER`
 * variant (asset-based, inventory + AR) — see the AAR. No product writes facts.
 *
 * Pure data + pure evaluation. No IO.
 */

import {
  PRODUCT_KEYS,
  requiredMetricsForProduct,
  type ProductKey,
} from "@/lib/finengine/registry/productMetricRegistry";
import { REQUIRED_DOCUMENTS_BY_PRODUCT } from "@/lib/finengine/products/requiredDocuments";
import { RISK_FACTORS_BY_PRODUCT } from "@/lib/finengine/products/productRiskFactors";
import { RECOMMENDED_COVENANTS_BY_PRODUCT } from "@/lib/finengine/products/productCovenants";

export type { ProductKey };
export { PRODUCT_KEYS };

export type ProductDefinition = {
  product: ProductKey;
  /** Canonical metric ids that a complete underwrite must be able to compute. */
  requiredMetrics: readonly string[];
  /** Document type keys required to underwrite the product. */
  requiredDocuments: readonly string[];
  /** Recommended covenant package (covenant type keys). */
  recommendedCovenants: readonly string[];
  /** Product-specific risk factors an analysis must address. */
  riskFactors: readonly string[];
};

/** Assemble the full definition for one product from the source-of-truth maps. */
export function getProductDefinition(product: ProductKey): ProductDefinition {
  return {
    product,
    requiredMetrics: requiredMetricsForProduct(product),
    requiredDocuments: REQUIRED_DOCUMENTS_BY_PRODUCT[product] ?? [],
    recommendedCovenants: RECOMMENDED_COVENANTS_BY_PRODUCT[product] ?? [],
    riskFactors: RISK_FACTORS_BY_PRODUCT[product] ?? [],
  };
}

/** Every product's definition — proves all products compile through one contract. */
export function allProductDefinitions(): ProductDefinition[] {
  return PRODUCT_KEYS.map(getProductDefinition);
}
