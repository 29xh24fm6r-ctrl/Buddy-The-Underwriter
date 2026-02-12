/**
 * Credit Lenses — Orchestrator
 *
 * Routes CreditSnapshot to the correct product lens.
 *
 * PHASE 4B: Interpretation layer only — no policy, no thresholds.
 */

import type { CreditSnapshot } from "@/lib/creditMetrics/types";
import type { ProductAnalysis, ProductType } from "./types";
import { computeSbaLens } from "./sba";
import { computeLocLens } from "./loc";
import { computeEquipmentLens } from "./equipment";
import { computeAcquisitionLens } from "./acquisition";
import { computeCreLens } from "./cre";

// Re-export types
export type { ProductAnalysis, ProductType } from "./types";

// Re-export individual lenses
export { computeSbaLens } from "./sba";
export { computeLocLens } from "./loc";
export { computeEquipmentLens } from "./equipment";
export { computeAcquisitionLens } from "./acquisition";
export { computeCreLens } from "./cre";

/**
 * Compute a product-specific analysis from a CreditSnapshot.
 *
 * Pure function — deterministic, no side effects.
 */
export function computeProductAnalysis(
  snapshot: CreditSnapshot,
  product: ProductType,
): ProductAnalysis {
  switch (product) {
    case "SBA":
      return computeSbaLens(snapshot);
    case "LOC":
      return computeLocLens(snapshot);
    case "EQUIPMENT":
      return computeEquipmentLens(snapshot);
    case "ACQUISITION":
      return computeAcquisitionLens(snapshot);
    case "CRE":
      return computeCreLens(snapshot);
  }
}
